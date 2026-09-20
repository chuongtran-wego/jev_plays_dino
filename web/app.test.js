import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

function cssRule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return styles.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))?.[1] || "";
}

test("decision log fills the remaining inspector height", () => {
  const logSection = cssRule(".log-section");
  const decisionLog = cssRule(".decision-log");

  assert.match(logSection, /min-height:\s*0\b/);
  assert.match(decisionLog, /flex:\s*1\b/);
  assert.match(decisionLog, /min-height:\s*0\b/);
  assert.doesNotMatch(decisionLog, /max-height:/);
});

test("starting a game clears decision history", () => {
  const resetGame = app.match(/function resetGame\(\)\s*\{([\s\S]*?)\n  \}/)?.[1] || "";
  const clearDecisionHistory = app.match(/function clearDecisionHistory\(\)\s*\{([\s\S]*?)\n  \}/)?.[1] || "";

  assert.match(resetGame, /clearDecisionHistory\(\)/);
  assert.match(clearDecisionHistory, /logs = \[\];/);
  assert.match(clearDecisionHistory, /latencies = \[\];/);
  assert.match(clearDecisionHistory, /renderLogs\(\)/);
  assert.match(clearDecisionHistory, /updateMetrics\(\)/);
});

test("stale AI decisions are ignored after a new game starts", () => {
  assert.match(app, /let gameSession = 0;/);
  assert.match(app, /const requestSession = gameSession;/);
  assert.match(app, /if \(requestSession !== gameSession\) return;/);
});
