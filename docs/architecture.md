# Architecture

## Why Next.js for this project

This operator UI needs both frontend pages and backend proxy logic in one deployable unit.
Next.js App Router provides a practical local-ops fit for v1:

- React-based UI pages for operator dashboards
- built-in server route handlers for KDF RPC proxying
- simple deployment model (`npm run build && npm run start`)
- easy growth path toward richer admin/control surfaces

This app follows a strict proxy boundary:

1. Browser requests internal API routes only.
2. API routes call server-side KCB services.
3. KCB services call KDF/MM2 client for reads/writes.
4. KDF client sends RPC payloads to configured KDF endpoint.

## Directory map

- `src/lib/kdf/client.ts`
  - Server-only RPC transport and method wrappers.
- `src/lib/kcb/*`
  - KCB logical backend (bootstrap config, capability resolution, coin cache, command queue).
- `src/lib/kcb/commands/service.ts`
  - Priority queue (`high`, `normal`), serial command execution, retention cleanup.
- `src/lib/kdf/adapters/*`
  - Maps raw RPC payloads into stable UI view models.
- `src/lib/kcb/orders/service.ts`
  - Direct order placement with pre-flight crossing check and popup notifications.
- `src/lib/kcb/orders/watcher.ts`
  - Background watcher that detects external taker fills on KCB-placed maker orders.
- `src/lib/system/restart.ts`
  - Server-only restart action with environment guard.
- `src/app/api/*`
  - Internal API boundary for browser consumers.
- `src/app/*/page.tsx`
  - Client pages with polling against internal APIs.
- `src/components/use-polling.ts`
  - Shared polling/data state hook.
- `deploy/systemd/komodo-marketmaker-gui.service`
  - Example systemd unit for production VM operation.
- `deploy/scripts/deploy.sh`
  - Repeatable VM deployment flow (pull/build/restart).
- `deploy/scripts/smoke-test.sh`
  - Operator smoke-test helper for KCB routes/flows.

## Data flow

`Page` → `fetch('/api/...')` → `Route Handler` → `kcb/*` → `kdf/client` → `KDF RPC`

For write actions:

`Page` → `POST /api/kcb/commands` → `KCB queue` → `executor` → `KDF/system control`

## Security posture

- No KDF endpoint URL or credentials are exposed as public env vars.
- Restart action requires `x-admin-token` header matching `MM2_RESTART_TOKEN`.
- Restart execution is intentionally narrow and safe:
  - `MM2_RESTART_MODE=systemctl` restarts one validated `*.service` only.
  - `MM2_RESTART_MODE=script` runs one fixed absolute wrapper script.
  - `MM2_RESTART_MODE=disabled` blocks restart action.

## Why browser never calls KDF directly

- Prevents leaking RPC URL/credentials to client bundles.
- Centralizes request shaping, error handling, and schema adaptation in one backend layer.
- Keeps pages stable even when KDF RPC payloads evolve.

## Growth path to full MM control UI

Current v1 scope is observability + minimal admin. This structure supports incremental growth:

1. add richer adapter view models for strategy/order details,
2. add controlled write actions in `src/lib/system` and `src/app/api`,
3. keep UI pages consuming only internal API contracts,
4. optionally add auth/audit trails later without reworking KDF integration boundaries.

## KCB state model

By default KCB stores state under `~/.kcb` (override with `KCB_CONFIG_DIR`) with this layout:

- `config/`
  - `bootstrap-config.json`
  - `kdf-capabilities.local.json`
  - `coin-sources.json` (coins/icons URLs + modular `price_sources` config)
- `cache/coins/`
  - `coins_config.json`
  - `coins_config.meta.json`
- `state/`
  - `commands.json`
  - `bootstrap-status.json`
  - `last-apply.json`
  - `resolved-capabilities.json`
- `logs/`
  - reserved for KCB-specific log output (future extension)
