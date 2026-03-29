# KDF Operator Console

Minimal Next.js operator UI for KDF/MM2 monitoring and basic admin control.

This project now includes an internal **KCB (Komodo Control Backend)** layer to separate GUI
concerns from direct KDF control operations.

## Security boundary

- Browser only calls internal `Next.js` routes under `/api/*`.
- KDF/MM2 RPC credentials stay on server-side (`src/lib/kdf/client.ts`).
- Write operations are routed through KCB command queue (`src/lib/kcb/commands/service.ts`).
- Restart action is server-side only (`src/lib/system/restart.ts`) and token-guarded.

## Quick start

1. Copy `.env.example` to `.env.local` and set values.
2. Install dependencies.
3. Start the app.

```bash
cp .env.example .env.local
npm install
npm run typecheck
npm run lint
npm run build
npm run dev
```

Open `http://localhost:3000`.

## Routes

### UI pages

- `/` dashboard status
- `/orders` open orders
- `/wallets` wallet balances
- `/movements` recent swaps/movements
- `/commands` KCB command queue and history
- `/admin` restart action

### Internal API routes

- `/api/kdf/status`
- `/api/kdf/orders`
- `/api/kdf/wallets`
- `/api/kdf/movements`
- `/api/admin/restart`

KCB-native routes:

- `/api/kcb/status`
- `/api/kcb/orders`
- `/api/kcb/wallets`
- `/api/kcb/movements`
- `/api/kcb/bootstrap-config` (GET/PUT, POST compatibility alias)
- `/api/kcb/bootstrap/apply` (POST)
- `/api/kcb/capabilities` (GET)
- `/api/kcb/coins/refresh` (POST)
- `/api/kcb/commands` (GET/POST)
- `/api/kcb/commands/:id` (GET)

## Notes

- This first version focuses on architecture and safe boundaries.
- Adapter mappings intentionally tolerate schema drift in upstream RPC payloads.
- If RPC methods differ in your deployment, adjust method names in `src/lib/kdf/client.ts`.
- Movements endpoint is intentionally honest: it reports when backend movement RPC is unavailable,
  instead of faking transfer history data.
- RPC API version routing is configured per method in `src/lib/kdf/rpc-methods.ts`.

## Environment variables

- `KDF_RPC_URL` (required)
- `KDF_RPC_USERPASS` (optional, server-side only)
- `KDF_RPC_TIMEOUT_MS` (optional)
- `KCB_CONFIG_DIR` (optional; default `~/.kcb`)
- `KCB_COINS_CONFIG_URL` (optional)
- `KCB_ICONS_BASE_URL` (optional)
- `KCB_HTTP_TIMEOUT_MS` (optional)
- `KCB_LOG_LEVEL` (optional)
- `KCB_COMMAND_RETENTION_SECONDS` (optional; default `30`)
- `MM2_RESTART_TOKEN` (required for admin restart route)
- `MM2_RESTART_MODE` (`disabled` | `systemctl` | `script`)
- `MM2_SYSTEMD_SERVICE` (required if mode is `systemctl`)
- `MM2_RESTART_SCRIPT` (required if mode is `script`)
- `NEXT_PUBLIC_POLL_MS` (optional)
- `DEBUG_MESSAGE_LEVEL` (`critical|error|warning|info|debug|trace`)
- `DEBUG_LOG_LEVEL` (`critical|error|warning|info|debug|trace`)
- `LOG_FILE` (debug log file path)

## Deployment on Linux VM (systemd)

Assuming KDF/MM2 already runs as a service and this app runs separately.

### Build and start manually

```bash
git pull
npm ci
npm run typecheck
npm run lint
npm run build
npm run start
```

### Common systemctl mode for restart action

Set these env values (for app runtime):

- `MM2_RESTART_MODE=systemctl`
- `MM2_SYSTEMD_SERVICE=mm2.service`

The backend then executes only:

- `systemctl restart mm2.service`

No arbitrary shell command input is accepted from the browser.

## Additional docs

See `docs/architecture.md` for module boundaries and data flow.
See `docs/kcb.md` for KCB storage, command lifecycle, and API details.
See `docs/deployment.md` for Linux VM deployment, systemd, and smoke-test runbook.
