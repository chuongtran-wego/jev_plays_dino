# Start All Services Script Design

## Goal

Provide one portable shell command that starts the local Laya-MLX service and the Go application together, keeps their logs visible, and shuts both processes down cleanly.

## Approach

Add a repository-root `start.sh` process supervisor. It resolves the repository directory from the script location, so it works regardless of the caller's current directory. It loads the root `.env` when present, validates the required executables, starts Laya first, then starts the Go server.

The Go server already embeds the browser application, so a separate Vite process is not required.

## Process Lifecycle

The script runs Laya with `laya-server/.venv/bin/python` and the Go application with `go run .`. Both run as child processes of the script. Signal traps handle `INT`, `TERM`, and normal exit, terminating and waiting for both children so `Ctrl+C` does not leave a service running.

The script waits for either service to exit. If one stops or fails, the script stops the other and returns the failed service's status.

## Configuration and Errors

Variables already exported by the caller take precedence. Values from the root `.env` fill the application's normal configuration when the file exists. Laya receives the same exported environment and continues to use its existing defaults for unspecified settings.

Before starting processes, the script checks for the `go` command and the Laya virtualenv Python executable. A missing dependency produces an actionable error, including the command needed to create and populate the virtualenv.

## Verification

Add a lightweight shell regression test that substitutes fake Go and Python executables, verifies that both services start, and confirms that stopping one child causes the other to be cleaned up. Also run the existing Go, JavaScript, production-build, and whitespace checks required by the repository guidelines.

Update the README local-run section to document `./start.sh` as the command for launching both services.
