#!/usr/bin/env bash

set -u

repo_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source_script="$repo_dir/start.sh"

if [[ ! -f "$source_script" ]]; then
  printf 'FAIL: expected %s to exist\n' "$source_script" >&2
  exit 1
fi

fixture_dir=$(mktemp -d "${TMPDIR:-/tmp}/jev-start-test.XXXXXX")
supervisor_pid=""

cleanup() {
  if [[ -n "$supervisor_pid" ]] && kill -0 "$supervisor_pid" 2>/dev/null; then
    kill -TERM "$supervisor_pid" 2>/dev/null || true
    wait "$supervisor_pid" 2>/dev/null || true
  fi
  rm -rf "$fixture_dir"
}
trap cleanup EXIT INT TERM

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

wait_for_line() {
  local expected=$1
  local file=$2
  local attempt

  for attempt in {1..100}; do
    if [[ -f "$file" ]] && grep -Fxq "$expected" "$file"; then
      return 0
    fi
    sleep 0.05
  done

  fail "timed out waiting for '$expected' in $file"
}

wait_for_exit() {
  local pid=$1
  local attempt

  for attempt in {1..100}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
    sleep 0.05
  done

  fail "process $pid did not exit"
}

run_lifecycle_test() {
  local test_root="$fixture_dir/lifecycle"
  local service_log="$test_root/services.log"
  local laya_pid_file="$test_root/laya.pid"
  local output_file="$test_root/supervisor.log"
  local laya_pid
  local status

  mkdir -p "$test_root/bin" "$test_root/laya-server/.venv/bin"
  cp "$source_script" "$test_root/start.sh"
  touch "$test_root/laya-server/server.py"
  chmod +x "$test_root/start.sh"

  cat >"$test_root/bin/go" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "go-started" >>"$SERVICE_LOG"
trap 'printf "%s\n" "go-stopped" >>"$SERVICE_LOG"; exit 0' TERM INT
while :; do sleep 0.1; done
EOF

  cat >"$test_root/laya-server/.venv/bin/python" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$$" >"$LAYA_PID_FILE"
printf '%s\n' "laya-started" >>"$SERVICE_LOG"
trap 'printf "%s\n" "laya-stopped" >>"$SERVICE_LOG"; exit 7' TERM INT
while :; do sleep 0.1; done
EOF

  chmod +x "$test_root/bin/go" "$test_root/laya-server/.venv/bin/python"

  (
    cd "$fixture_dir"
    SERVICE_LOG="$service_log" \
      LAYA_PID_FILE="$laya_pid_file" \
      PATH="$test_root/bin:$PATH" \
      "$test_root/start.sh" >"$output_file" 2>&1
  ) &
  supervisor_pid=$!

  wait_for_line "go-started" "$service_log"
  wait_for_line "laya-started" "$service_log"
  [[ -s "$laya_pid_file" ]] || fail "Laya PID was not recorded"

  laya_pid=$(<"$laya_pid_file")
  kill -TERM "$laya_pid"
  wait_for_exit "$supervisor_pid"

  set +e
  wait "$supervisor_pid"
  status=$?
  set -e
  supervisor_pid=""

  [[ $status -ne 0 ]] || fail "supervisor succeeded after Laya stopped"
  wait_for_line "laya-stopped" "$service_log"
  wait_for_line "go-stopped" "$service_log"
}

run_missing_venv_test() {
  local test_root="$fixture_dir/missing-venv"
  local output_file="$test_root/supervisor.log"
  local status

  mkdir -p "$test_root/bin" "$test_root/laya-server"
  cp "$source_script" "$test_root/start.sh"
  chmod +x "$test_root/start.sh"

  cat >"$test_root/bin/go" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
  chmod +x "$test_root/bin/go"

  set +e
  PATH="$test_root/bin:$PATH" "$test_root/start.sh" >"$output_file" 2>&1
  status=$?
  set -e

  [[ $status -ne 0 ]] || fail "supervisor succeeded without the Laya virtualenv"
  grep -Fq "Laya virtualenv is missing" "$output_file" || \
    fail "missing virtualenv error was not actionable"
}

set -e
run_lifecycle_test
run_missing_venv_test
printf '%s\n' "start.sh supervisor tests passed"
