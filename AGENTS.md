# Repository Guidelines

## Project Structure & Module Organization

`main.go` contains the Go HTTP server, TypeSafe AI client, API handlers, simulation policy, and embedded frontend. Server tests live beside it in `main_test.go`. Browser code is under `web/`: `app.js` owns game state and rendering, `styles.css` defines the responsive UI, and `index.html` provides the page structure. Frontend regression tests use `web/*.test.js`. Store screenshots and implementation notes in `docs/`; Vite writes production assets to generated `dist/`.

## Build, Test, and Development Commands

- `go run .` starts the complete application on `PORT` (default `8080`).
- `npm run dev` starts Vite for frontend development.
- `go test ./...` runs Go unit tests.
- `npm test` runs Node's built-in frontend test suite.
- `npm run build` creates the production frontend bundle in `dist/`.
- `make test` runs Go tests plus a JavaScript syntax check; run `npm test` separately for frontend regressions.
- `make build` compiles the server to `bin/jev-plays-dino`.

Before submitting changes, run `go test ./...`, `npm test`, `npm run build`, and `git diff --check`.

## Coding Style & Naming Conventions

Format Go files with `gofmt`; follow idiomatic Go naming (`PascalCase` for exported identifiers and `camelCase` internally). JavaScript uses two-space indentation, semicolons, double quotes, and `camelCase` names. CSS classes and HTML IDs use kebab-case, for example `decision-log`. Keep game constants near the top of `web/app.js` and avoid mixing unrelated refactors into focused fixes.

## Testing Guidelines

Use Go's `testing` package and name tests `TestBehavior`, such as `TestMockDecisionCactus`. Frontend tests use `node:test` with `node:assert/strict` and belong in `*.test.js`. Every bug fix should include a regression test that fails before the fix. Cover decision policy, request lifecycle, stale responses, latency accounting, and UI layout contracts when those areas change.

## Commit & Pull Request Guidelines

Recent commits use concise, imperative subjects such as `Add complete Jev Plays Dino demo` and `Keep simulation mode as default`. Follow that style and keep each commit cohesive. Pull requests should explain user-visible behavior, list verification commands, link relevant issues, and include before/after screenshots for layout or animation changes.

## Security & Configuration

Keep `TYPESAFE_API_KEY` in `.env` or the deployment environment; never commit credentials. Use `.env.example` for documented configuration and preserve the simulation fallback for contributors without API access.
