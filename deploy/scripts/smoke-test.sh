#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
ADMIN_TOKEN="${MM2_RESTART_TOKEN:-${ADMIN_TOKEN:-}}"

step() {
  echo ""
  echo "==> $1"
}

call_get() {
  local path="$1"
  echo "[GET] ${BASE_URL}${path}"
  curl --fail --silent --show-error "${BASE_URL}${path}" > /tmp/kcb-smoke.json
  head -c 300 /tmp/kcb-smoke.json || true
  echo
}

call_post() {
  local path="$1"
  local body="$2"
  local -a args
  args=(
    --fail --silent --show-error
    -X POST
    -H "Content-Type: application/json"
    -d "$body"
  )
  if [[ -n "$ADMIN_TOKEN" ]]; then
    args+=( -H "x-admin-token: ${ADMIN_TOKEN}" )
  fi

  echo "[POST] ${BASE_URL}${path}"
  curl "${args[@]}" "${BASE_URL}${path}" > /tmp/kcb-smoke.json
  head -c 300 /tmp/kcb-smoke.json || true
  echo
}

call_put() {
  local path="$1"
  local body="$2"
  local -a args
  args=(
    --fail --silent --show-error
    -X PUT
    -H "Content-Type: application/json"
    -d "$body"
  )
  if [[ -n "$ADMIN_TOKEN" ]]; then
    args+=( -H "x-admin-token: ${ADMIN_TOKEN}" )
  fi

  echo "[PUT] ${BASE_URL}${path}"
  curl "${args[@]}" "${BASE_URL}${path}" > /tmp/kcb-smoke.json
  head -c 300 /tmp/kcb-smoke.json || true
  echo
}

step "1) App is reachable"
call_get "/api/kcb/status"

step "2) KCB routes respond"
call_get "/api/kcb/orders"
call_get "/api/kcb/wallets"
call_get "/api/kcb/movements"
call_get "/api/kcb/capabilities"

step "3) Coin definitions refresh + cache"
call_post "/api/kcb/coins/refresh" '{}'

step "4) Bootstrap config read/write"
call_get "/api/kcb/bootstrap-config"
call_put "/api/kcb/bootstrap-config" '{"version":1,"kcb_log_level":"info","coins":[],"simple_mm":{"enabled":false,"start_on_apply":false}}'

step "5) Bootstrap apply command"
call_post "/api/kcb/bootstrap/apply" '{}'

step "6) Command queue state"
call_get "/api/kcb/commands"

step "7) Restart command enqueue (requires token)"
if [[ -n "$ADMIN_TOKEN" ]]; then
  call_post "/api/admin/restart" '{}'
else
  echo "Skipping restart command test (set ADMIN_TOKEN or MM2_RESTART_TOKEN)"
fi

step "Done"
