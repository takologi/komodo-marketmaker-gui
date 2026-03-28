# Deployment and Operations (Linux VM)

This document covers practical deployment/testing for the current architecture:

- **GUI**: Next.js frontend pages
- **KCB**: logical backend layer inside this Next.js app
- **KDF**: execution engine (external service)

No standalone KCB service is introduced in this phase.

## Architecture reminder

Control flow remains:

`GUI -> /api/kcb/* -> KCB services -> KDF/system adapters`

Read-path APIs do not use the command queue. Write/control operations are queue-backed.

## VM prerequisites

- Linux VM with Node.js/npm installed
- KDF running as systemd service (example: `mm2.service`)
- repository cloned to a deployment path (example: `/opt/komodo-marketmaker-gui`)

## Environment setup

Copy and edit environment:

- `cp .env.example .env.local`

Key variables for operations:

- `KDF_RPC_URL` (required)
- `KDF_RPC_USERPASS` (optional)
- `KDF_RPC_TIMEOUT_MS` (optional)
- `KDF_RPC_MMRPC_VERSION` (optional)
- `KCB_CONFIG_DIR` (optional, default `~/.kcb`)
- `KCB_COINS_CONFIG_URL` (optional)
- `KCB_ICONS_BASE_URL` (optional)
- `KCB_HTTP_TIMEOUT_MS` (optional)
- `KCB_LOG_LEVEL` (optional)
- `KCB_COMMAND_RETENTION_SECONDS` (optional, default `30`)
- `MM2_RESTART_TOKEN` (required for write/admin APIs)
- `MM2_RESTART_MODE` (`disabled | systemctl | script`)
- `MM2_SYSTEMD_SERVICE` (required when `MM2_RESTART_MODE=systemctl`)
- `MM2_RESTART_SCRIPT` (required when `MM2_RESTART_MODE=script`)

## KCB directory layout

Default root: `~/.kcb` (override with `KCB_CONFIG_DIR`).

- `config/bootstrap-config.json`
- `config/kdf-capabilities.local.json`
- `config/coin-sources.json`
- `cache/coins/coins_config.json`
- `cache/coins/coins_config.meta.json`
- `cache/icons/`
- `state/commands.json`
- `state/bootstrap-status.json`
- `state/last-apply.json`
- `state/resolved-capabilities.json`
- `logs/`

## First-run behavior

On first run, KCB initializes layout automatically and creates default config files.

If `cache/coins/coins_config.json` is missing, KCB fetches the coin source on first use. If fetch fails, APIs return explicit errors and logs include source URL + failure reason.

## Systemd integration

A sample unit is provided:

- `deploy/systemd/komodo-marketmaker-gui.service`

Install example:

1. copy unit file to `/etc/systemd/system/komodo-marketmaker-gui.service`
2. adjust `User`, `Group`, `WorkingDirectory`, and `EnvironmentFile`
3. run:
   - `sudo systemctl daemon-reload`
   - `sudo systemctl enable komodo-marketmaker-gui`
   - `sudo systemctl restart komodo-marketmaker-gui`
   - `sudo systemctl status komodo-marketmaker-gui --no-pager`

## Deploy workflow

Manual:

- `git pull --ff-only`
- `npm ci`
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `sudo systemctl restart komodo-marketmaker-gui`

Scripted:

- `npm run deploy:vm`

or directly:

- `bash ./deploy/scripts/deploy.sh`

## Smoke-test flow

Script:

- `npm run smoke:test`

or directly:

- `bash ./deploy/scripts/smoke-test.sh`

Optional env overrides:

- `BASE_URL=http://127.0.0.1:3000`
- `ADMIN_TOKEN=<token>` (or `MM2_RESTART_TOKEN`)

The smoke test verifies:

1. app reachable
2. KCB read routes
3. coin refresh command enqueue
4. bootstrap read/write
5. bootstrap apply enqueue
6. command queue visibility
7. restart enqueue (if token provided)

## DOC/MARTY practical setup

Use provided examples:

- `deploy/examples/bootstrap-config.example.json`
- `deploy/examples/coin-sources.example.json`

Write bootstrap config using:

- `PUT /api/kcb/bootstrap-config`

Then queue apply:

- `POST /api/kcb/bootstrap/apply`

Observe queue and statuses:

- `GET /api/kcb/commands`
- `GET /api/kcb/commands/:id`

## Failure visibility checklist

- KDF unreachable: explicit transport error includes endpoint context
- Auth failure: HTTP 401/403 hint includes credential guidance
- Coin source failures: refresh error logs source URL + message
- Invalid/missing KCB config JSON: file is recovered where practical and warning/error is logged
- Command failures: command status set to `failed`, `finished_at` populated, `error_message` stored

## Known limitations

- Command store is file-based, in-process locking (single-instance oriented)
- Periodic cleanup is best-effort in-process; restarts reset timer state
- No distributed queue semantics in this phase
