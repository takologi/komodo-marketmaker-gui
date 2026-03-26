# KDF Operator Console

Minimal Next.js operator UI for KDF/MM2 monitoring and basic admin control.

## Security boundary

- Browser only calls internal `Next.js` routes under `/api/*`.
- KDF/MM2 RPC credentials stay on server-side (`src/lib/kdf/client.ts`).
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
- `/admin` restart action

### Internal API routes

- `/api/kdf/status`
- `/api/kdf/orders`
- `/api/kdf/wallets`
- `/api/kdf/movements`
- `/api/admin/restart`

## Notes

- This first version focuses on architecture and safe boundaries.
- Adapter mappings intentionally tolerate schema drift in upstream RPC payloads.
- If RPC methods differ in your deployment, adjust method names in `src/lib/kdf/client.ts`.
- Movements endpoint is intentionally honest: it reports when backend movement RPC is unavailable,
  instead of faking transfer history data.

## Environment variables

- `KDF_RPC_URL` (required)
- `KDF_RPC_USERPASS` (optional, server-side only)
- `KDF_RPC_TIMEOUT_MS` (optional)
- `KDF_RPC_MMRPC_VERSION` (optional; leave empty for legacy-compatible methods)
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
