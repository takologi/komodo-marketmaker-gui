# KCB (Komodo Control Backend)

KCB is the internal backend layer between the GUI/API routes and KDF/MM2 control endpoints.
It centralizes:

- bootstrap configuration and apply flow,
- capability discovery,
- coin metadata caching,
- command queueing/execution/retention.

For this phase, KCB intentionally remains inside the Next.js backend as a logical layer (not a
standalone deployable service) to keep deployment simple while enforcing strict GUI -> KCB -> KDF
boundaries. Routes/services are designed so KCB can later be extracted with minimal redesign.

## Storage layout

Default root: `~/.kcb` (override with `KCB_CONFIG_DIR`).

- `config/bootstrap-config.json` — desired bootstrap plan (coins, simple MM flags)
- `config/kdf-capabilities.local.json` — local capability overrides
- `config/coin-sources.json` — URLs for coins config and icons base
- `cache/coins/coins_config.json` — cached coins definition payload
- `cache/coins/coins_config.meta.json` — fetch metadata
- `state/commands.json` — command queue + command history
- `state/bootstrap-status.json` — current/last bootstrap execution status
- `state/last-apply.json` — summary from last bootstrap apply
- `state/resolved-capabilities.json` — computed capability state snapshot

## Command queue

Implemented in `src/lib/kcb/commands/service.ts`:

- command types: `restart_kdf`, `apply_bootstrap`, `refresh_coins`
- priority: `high | normal`
- statuses: `queued | running | done | failed`
- serial execution in-process
- retention cleanup controlled by `KCB_COMMAND_RETENTION_SECONDS` (default `30`)

Cleanup behavior:

- opportunistic cleanup on command reads/writes
- best-effort in-process interval cleanup job started on first command API usage

State hardening behavior:

- atomic JSON writes via temp-file + rename
- corrupt command/config JSON files are backed up with `.corrupt.<timestamp>` suffix when recoverable
- command store uses lightweight in-process lock to reduce write races in single-instance deployments

`high` priority commands are inserted at the front of the queue.

Limitations (current phase):

- lock scope is process-local; multi-process deployments sharing one KCB directory are not supported

## API

### Read

- `GET /api/kcb/status`
- `GET /api/kcb/orders`
- `GET /api/kcb/wallets`
- `GET /api/kcb/movements`
- `GET /api/kcb/capabilities`
- `GET /api/kcb/bootstrap-config`
- `GET /api/kcb/commands`
- `GET /api/kcb/commands/:id`

### Write (token required: `x-admin-token` == `MM2_RESTART_TOKEN`)

- `PUT /api/kcb/bootstrap-config`
- `POST /api/kcb/bootstrap-config` (compatibility alias)
- `POST /api/kcb/bootstrap/apply`
- `POST /api/kcb/coins/refresh`
- `POST /api/kcb/commands`

## UI integration

- Existing pages poll KCB routes directly (`/api/kcb/*`).
- Legacy `/api/kdf/*` routes are retained as compatibility wrappers and now delegate to KCB.
- `/admin` restart now queues a high-priority KCB command.
- `/commands` page displays queue/history and supports queueing selected commands.

## Direct orders

Direct orders are verbatim maker orders defined in `bootstrap-config.json` under `direct_orders`.
They are applied as part of the bootstrap flow (including on startup) via `applyDirectOrders` in
`src/lib/kcb/orders/service.ts`.

### Apply strategy

1. Group orders by `(base, rel)` pair.
2. Cancel all existing maker orders for each group via `cancel_all_orders(Pair)` — returns the
   actually-cancelled UUIDs, which are registered as intentionally cancelled so the watcher does
   not generate a "filled" popup for them.
3. Place each order in the group with `cancel_previous=false`. All orders for a pair coexist as
   independent price levels.

### Pre-flight crossing check

Before placing each order as a `setprice` maker, KCB scans the reverse orderbook for entries
that would cross the proposed price:

- **Cross condition** for `BASE/REL @ P_ask` (P_ask in REL/BASE units):
  fetch `orderbook(REL, BASE)` → entry crosses if `entry.price (BASE/REL) ≤ 1/P_ask`

- **Self-cross (own maker)**: if any crossing entry UUID belongs to our own open orders, the
  proposed order is **refused entirely** and a warning popup is shown. KDF prevents same-instance
  self-matching, so placing such an order as a taker would leave it stuck.

- **Other-cross (external maker)**: KCB places a `sell BASE/REL` taker order to consume each
  crossing entry (best fill rate first, volumes converted to BASE units). Any volume not consumed
  is then placed as the residual `setprice` maker.

Price constraints for `direct_orders`:

- `MARTY/DOC` bids must have price (MARTY/DOC) < `1/min(DOC/MARTY ask)` to avoid being refused.
- Example: with DOC/MARTY asks at 1.1–1.5, valid MARTY/DOC bid prices start above 1/1.1 ≈ 0.909
  expressed as MARTY/DOC. The example config uses 1.12, 1.30, 1.50, 1.75, 2.10.

### Popup notifications

Four user-facing popup events fire via `pushPopupNotification`:

| Event | Severity | When |
|-------|----------|------|
| **Maker order placed** | `info` | `setprice` call succeeded; shows pair, price, volume, short UUID |
| **Taker fill placed** | `info` | `sell` taker placed against a crossing external maker; shows pair, fill volume, maker UUID |
| **Order refused — self-cross** | `warning` | Proposed order would cross own maker; shows pair, price, crossing UUID |
| **Maker order taken** | `info` | Watcher detected an external taker filled our maker order (see below) |

Popups are displayed in `DebugPopupCenter` (polled every 1.5 s, auto-close after
`DEBUG_MESSAGE_TIMEOUT` seconds, default 8).

## Maker order watcher

`src/lib/kcb/orders/watcher.ts` runs a background interval (every 10 s) that:

1. Fetches `my_orders` to get currently active order UUIDs.
2. For each KCB-tracked UUID no longer present:
   - If KCB cancelled it intentionally (registered via `markIntentionallyCancelled`): silent.
   - Otherwise: fires a **"Maker order taken"** `info` popup — an external KDF instance
     placed a taker order that matched and consumed our maker order.

The watcher is started on the first `applyDirectOrders` call (including the startup bootstrap)
and runs for the lifetime of the Next.js server process.

