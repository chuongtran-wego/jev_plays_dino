#!/usr/bin/env bash

set -Eeuo pipefail

repo_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
laya_python="$repo_dir/laya-server/.venv/bin/python"
laya_pid=""
go_pid=""
cleaning_up=0

trim_whitespace() {
  local value=$1
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

load_env() {
  local env_file=$1
  local raw_line
  local line
  local key
  local value

  [[ -f "$env_file" ]] || return 0

  while IFS= read -r raw_line || [[ -n "$raw_line" ]]; do
    line=$(trim_whitespace "$raw_line")
    [[ -z "$line" || "$line" == \#* ]] && continue

    if [[ "$line" == export\ * ]]; then
      line=$(trim_whitespace "${line#export }")
    fi
    if [[ "$line" != *=* ]]; then
      printf 'Invalid environment entry in %s: %s\n' "$env_file" "$raw_line" >&2
      return 1
    fi

    key=$(trim_whitespace "${line%%=*}")
    if [[ ! "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      printf 'Invalid environment key in %s: %s\n' "$env_file" "$key" >&2
      return 1
    fi
    if printenv "$key" >/dev/null 2>&1; then
      continue
    fi

    value=$(trim_whitespace "${line#*=}")
    if (( ${#value} >= 2 )); then
      if [[ "$value" == \"*\" && "$value" == *\" ]]; then
        value=${value:1:${#value}-2}
      elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
        value=${value:1:${#value}-2}
      fi
    fi

    printf -v "$key" '%s' "$value"
    export "$key"
  done <"$env_file"
}

stop_child() {
  local pid=$1
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    kill -TERM "$pid" 2>/dev/null || true
  fi
}

cleanup() {
  local status=$?

  if (( cleaning_up )); then
    return
  fi
  cleaning_up=1
  trap - EXIT INT TERM

  stop_child "$laya_pid"
  stop_child "$go_pid"

  if [[ -n "$laya_pid" ]]; then
    wait "$laya_pid" 2>/dev/null || true
  fi
  if [[ -n "$go_pid" ]]; then
    wait "$go_pid" 2>/dev/null || true
  fi

  exit "$status"
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

load_env "$repo_dir/.env"
load_env "$repo_dir/laya-server/.env"

if ! command -v go >/dev/null 2>&1; then
  printf '%s\n' "Go is required but was not found in PATH." >&2
  exit 1
fi

if [[ ! -x "$laya_python" ]]; then
  printf '%s\n' \
    "Laya virtualenv is missing. Run:" \
    "  python3.11 -m venv laya-server/.venv" \
    "  laya-server/.venv/bin/pip install -r laya-server/requirements.txt" >&2
  exit 1
fi

printf '%s\n' "Starting Laya-MLX on http://${LAYA_HOST:-127.0.0.1}:${LAYA_PORT:-8090}"
(
  cd "$repo_dir/laya-server"
  exec "$laya_python" server.py
) &
laya_pid=$!

printf '%s\n' "Starting Jev Plays Dino on http://localhost:${PORT:-8080}"
(
  cd "$repo_dir"
  exec go run .
) &
go_pid=$!

printf '%s\n' "Both services are running. Press Ctrl+C to stop."

while kill -0 "$laya_pid" 2>/dev/null && kill -0 "$go_pid" 2>/dev/null; do
  sleep 0.1
done

set +e
if ! kill -0 "$laya_pid" 2>/dev/null; then
  wait "$laya_pid"
  child_status=$?
  stopped_service="Laya-MLX"
else
  wait "$go_pid"
  child_status=$?
  stopped_service="Jev Plays Dino"
fi
set -e

if (( child_status == 0 )); then
  child_status=1
fi
printf '%s stopped; shutting down all services.\n' "$stopped_service" >&2
exit "$child_status"
