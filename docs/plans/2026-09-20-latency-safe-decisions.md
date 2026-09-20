# Latency-Safe Decisions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Jev decisions safe under cold-start and steady-state API latency without hiding the actual end-to-end response time.

**Architecture:** Jev will choose one maneuver per obstacle as soon as it enters a long planning horizon. The browser will schedule that maneuver locally at the correct collision window and use the deterministic rule controller only when the remote plan misses its deadline. The Go client will preconnect to TypeSafe during startup, while the browser will measure and display full request latency.

**Tech Stack:** Go 1.22 `net/http`, browser JavaScript, Node.js built-in test runner.

---

### Task 1: Define planning behavior

**Files:**
- Modify: `main_test.go`
- Modify: `main.go`

1. Add failing tests proving far-away cacti and low birds produce maneuver plans rather than immediate `continue` actions.
2. Run `go test ./...` and confirm the far-obstacle cases fail.
3. Change the mock policy and TypeSafe question instructions to choose a maneuver for the obstacle independent of the current press timing.
4. Run `go test ./...` and confirm the tests pass.

### Task 2: Warm the TypeSafe connection

**Files:**
- Modify: `main_test.go`
- Modify: `main.go`

1. Add a failing transport-level test for an authenticated `HEAD /v1/systemone` preconnect request.
2. Implement `jevClient.warm` and call it with a bounded timeout before the HTTP server starts accepting game traffic.
3. Run `go test ./...` and confirm the warm-up test passes.

### Task 3: Schedule remote plans locally

**Files:**
- Modify: `web/app.test.js`
- Modify: `web/app.js`

1. Add failing source-contract tests for one remote request per obstacle, plan storage, no immediate execution on response, local scheduled execution, and deadline fallback.
2. Run `npm test` and confirm the new assertions fail.
3. Request a decision once within the planning horizon, attach the returned maneuver to the live obstacle, and execute it locally at the rule controller's timing threshold.
4. Use the deterministic controller only when no plan exists at the action deadline; discard responses for expired obstacles or ended games.
5. Run `npm test` and confirm all tests pass.

### Task 4: Report end-to-end latency

**Files:**
- Modify: `web/app.test.js`
- Modify: `web/app.js`

1. Add a failing assertion that the browser always replaces API-only latency with elapsed browser request time while preserving API latency separately.
2. Implement the end-to-end measurement for both success and fallback responses.
3. Run `npm test` and confirm all tests pass.

### Task 5: Verify behavior

**Files:**
- Verify: `main.go`, `main_test.go`, `web/app.js`, `web/app.test.js`

1. Run `npm test`, `go test ./...`, `npm run build`, and `git diff --check`.
2. Start a fresh local server and compare the first live TypeSafe request with subsequent requests.
3. Review the final diff for unrelated changes and document any verification limitation.
