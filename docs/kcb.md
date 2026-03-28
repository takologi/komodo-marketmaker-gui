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
