import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

function cssRule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return styles.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))?.[1] || "";
}

test("decision log fills the remaining inspector height", () => {
  const appShell = cssRule(".app-shell");
  const workspace = cssRule(".workspace");
  const logSection = cssRule(".log-section");
  const decisionLog = cssRule(".decision-log");
  const logEntry = cssRule(".log-entry");

  assert.match(appShell, /height:\s*100dvh\b/);
  assert.match(appShell, /overflow:\s*hidden\b/);
  assert.match(workspace, /min-height:\s*0\b/);
  assert.match(workspace, /overflow:\s*hidden\b/);
  assert.match(logSection, /min-height:\s*0\b/);
  assert.match(decisionLog, /flex:\s*1\b/);
  assert.match(decisionLog, /min-height:\s*0\b/);
  assert.match(decisionLog, /overflow-y:\s*auto\b/);
  assert.match(logEntry, /flex:\s*0\s+0\s+auto\b/);
  assert.doesNotMatch(decisionLog, /max-height:/);
});

test("stacked layout gives the inspector a bounded scroll viewport", () => {
  assert.match(styles, /@media \(max-width: 1100px\)[\s\S]*?\.app-shell\s*\{[^}]*height:\s*auto[^}]*overflow:\s*visible/);
  assert.match(styles, /@media \(max-width: 1100px\)[\s\S]*?\.inspector\s*\{[^}]*height:\s*min\(760px, calc\(100dvh - 28px\)\)/);
});

test("decision log retains every entry until the game is restarted or cleared", () => {
  const addLog = app.match(/function addLog\(action, confidence, latency\)\s*\{([\s\S]*?)\n  \}/)?.[1] || "";

  assert.match(addLog, /logs\.unshift/);
  assert.doesNotMatch(addLog, /logs\.slice/);
});

test("starting a game clears decision history", () => {
  const resetGame = app.match(/function resetGame\([^)]*\)\s*\{([\s\S]*?)\n  \}/)?.[1] || "";
  const clearDecisionHistory = app.match(/function clearDecisionHistory\(\)\s*\{([\s\S]*?)\n  \}/)?.[1] || "";

  assert.match(resetGame, /clearDecisionHistory\(\)/);
  assert.match(clearDecisionHistory, /logs = \[\];/);
  assert.match(clearDecisionHistory, /latencies = \[\];/);
  assert.match(clearDecisionHistory, /renderLogs\(\)/);
  assert.match(clearDecisionHistory, /updateMetrics\(\)/);
});

test("try again lets the first obstacle enter from beyond the right edge", () => {
  const resetGame = app.match(/function resetGame\([^)]*\)\s*\{([\s\S]*?)\n  \}/)?.[1] || "";
  const spawnObstacle = app.match(/function spawnObstacle\(\)\s*\{([\s\S]*?)\n  \}/)?.[1] || "";

  assert.match(resetGame, /spawnObstacle\(\)/);
  assert.doesNotMatch(resetGame, /obstacles\[0\]\.x\s*=/);
  assert.match(spawnObstacle, /x:\s*WIDTH \+ 20/);
});

test("reset enters a waiting state until Start again is clicked", () => {
  const resetGame = app.match(/function resetGame\(([^)]*)\)\s*\{([\s\S]*?)\n  \}/);

  assert.match(resetGame?.[1] || "", /waitForStart = false/);
  assert.match(resetGame?.[2] || "", /awaitingStart = waitForStart/);
  assert.match(resetGame?.[2] || "", /"Start again"/);
  assert.match(app, /if \(paused \|\| gameOver \|\| awaitingStart\) return;/);
  assert.match(app, /els\["reset-button"\]\.addEventListener\("click", \(\) => resetGame\(\{ waitForStart: true \}\)\)/);
  assert.match(app, /els\["try-again-button"\]\.addEventListener\("click", resetGame\)/);
});

test("stale AI decisions are ignored after a new game starts", () => {
  assert.match(app, /let gameSession = 0;/);
  assert.match(app, /const requestSession = gameSession;/);
  assert.match(app, /if \(requestSession !== gameSession\) return;/);
});

test("Jev requests one early maneuver plan per obstacle", () => {
  assert.match(app, /const PLANNING_LOOKAHEAD = 900;/);
  assert.match(app, /decisionRequested: false/);
  assert.match(app, /obstacle\.decisionRequested \|\| pendingDecision/);
  assert.match(app, /obstacle\.decisionRequested = true;/);
  assert.match(app, /liveObstacle\.plannedAction = decision\.action;/);
});

test("Laya is available as a typed AI controller", () => {
  assert.match(html, /class="mode-button" data-mode="laya">Laya</);
  assert.match(app, /engine:\s*mode/);
  assert.match(app, /mode === "jev" \|\| mode === "laya"/);
  assert.match(app, /engine === "laya-mlx"/);
});

test("Jev mode only schedules maneuvers returned by Jev", () => {
  const requestDecision = app.match(/async function requestJevDecision\(obstacle\)\s*\{([\s\S]*?)\n  \}/)?.[1] || "";
  const scheduleJevAction = app.match(/function scheduleJevAction\(obstacle\)\s*\{([\s\S]*?)\n  \}/)?.[1] || "";

  assert.doesNotMatch(requestDecision, /executeAction\(decision\.action\)/);
  assert.match(app, /function scheduleJevAction\(obstacle\)/);
  assert.match(scheduleJevAction, /if \(obstacle\.actionExecuted \|\| !obstacle\.plannedAction\) return;/);
  assert.match(scheduleJevAction, /executeScheduledAction\(obstacle, obstacle\.plannedAction\)/);
  assert.doesNotMatch(scheduleJevAction, /ruleDecision|executeRuleDecision|defaultManeuver|fallback/i);
  assert.match(app, /if \(!liveObstacle \|\| gameOver \|\| liveObstacle\.actionExecuted\) return;/);
});

test("Jev API error fallback is identified in the decision log", () => {
  const requestDecision = app.match(/async function requestJevDecision\(obstacle\)\s*\{([\s\S]*?)\n  \}/)?.[1] || "";
  const showDecision = app.match(/function showDecision\(decision, state\)\s*\{([\s\S]*?)\n  \}/)?.[1] || "";

  assert.match(requestDecision, /fallback_reason:\s*"API ERROR"/);
  assert.match(showDecision, /decision\.fallback_reason/);
  assert.match(app, /class="fallback-badge"/);
});

test("collision risk is derived locally from action probabilities", () => {
  const showDecision = app.match(/function showDecision\(decision, state\)\s*\{([\s\S]*?)\n  \}/)?.[1] || "";

  assert.match(showDecision, /const risk = \(1 - \(probabilities\.continue \|\| 0\)\) \* 5;/);
  assert.doesNotMatch(showDecision, /decision\.collision_risk/);
});

test("decision latency is measured end to end in the browser", () => {
  assert.match(app, /decision\.api_latency_ms = decision\.latency_ms;/);
  assert.match(app, /decision\.latency_ms = Math\.round\(performance\.now\(\) - started\);/);
});

test("late decisions count toward latency metrics without being executed", () => {
  const responseParsedAt = app.indexOf("const decision = await response.json();");
  const measuredAt = app.indexOf("decision.latency_ms = Math.round(performance.now() - started);");
  const recordedAt = app.indexOf("showDecision(decision, state);", measuredAt);
  const staleGuardAt = app.indexOf("if (!liveObstacle || gameOver || liveObstacle.actionExecuted) return;", responseParsedAt);

  assert.ok(measuredAt > responseParsedAt);
  assert.ok(recordedAt > measuredAt);
  assert.ok(staleGuardAt > recordedAt);
});

test("game speed presets are 1x, 2x, 4x, and 8x", () => {
  const speedButtons = [...html.matchAll(/class="speed-button(?: active)?" data-speed="(\d+)"/g)]
    .map(match => Number(match[1]));

  assert.deepEqual(speedButtons, [1, 2, 4, 8]);
  assert.match(app, /\[1, 2, 4, 8\]\.includes\(multiplier\)/);
});

test("game canvas keeps a wide fixed aspect ratio instead of stretching to the panel", () => {
  const canvasRule = cssRule("#game-canvas");
  const [, width, height] = html.match(/<canvas id="game-canvas" width="(\d+)" height="(\d+)"/).map(Number);

  assert.match(canvasRule, new RegExp(`aspect-ratio:\\s*${width}\\s*/\\s*${height}\\b`));
  assert.doesNotMatch(canvasRule, /height:\s*100%/);
  assert.doesNotMatch(canvasRule, /min-height/);
  assert.doesNotMatch(styles, /\.game-panel[^{]*\{[^}]*(min-height|flex:\s*1)/);
  assert.ok(width / height >= 3.5, "canvas should stay close to the 4:1 strip of the Chrome game");
});

test("canvas constants match the markup and keep the scene inside the frame", () => {
  const constant = name => Number(app.match(new RegExp(`const ${name} = (-?[\\d.]+);`))?.[1]);
  const [, width, height] = html.match(/<canvas id="game-canvas" width="(\d+)" height="(\d+)"/).map(Number);
  const dinoHeight = Number(app.match(/const dino = \{[^}]*height: (\d+)/)?.[1]);
  const jumpApex = constant("GROUND") - dinoHeight - constant("JUMP_VELOCITY") ** 2 / (2 * constant("GRAVITY"));
  // drawGround places its lowest dots at GROUND + 35 with a 3 px height.
  const groundTextureDepth = 38;

  assert.equal(constant("WIDTH"), width);
  assert.equal(constant("HEIGHT"), height);
  assert.ok(jumpApex >= 0, `jump apex at y=${jumpApex} is clipped by the top edge`);
  assert.ok(constant("GROUND") + groundTextureDepth <= height, "ground texture is clipped by the bottom edge");
  assert.match(cssRule(".game-badge"), new RegExp(`top:\\s*calc\\(${Math.round(constant("GROUND") / height * 100)}% \\+ \\d+px\\)`));
  assert.match(app, /drawCloud\([^,]+, GROUND - \d+, [\d.]+\)/);
  assert.doesNotMatch(app, /drawCloud\([^,]+, \d+, [\d.]+\)/);
});

test("canvas renders at device pixel ratio while CSS owns the displayed size", () => {
  const sizeCanvas = app.match(/function sizeCanvas\(\)\s*\{([\s\S]*?)\n  \}/)?.[1] || "";

  assert.match(sizeCanvas, /canvas\.width = Math\.round\(WIDTH \* dpr\)/);
  assert.match(sizeCanvas, /canvas\.height = Math\.round\(HEIGHT \* dpr\)/);
  assert.match(sizeCanvas, /ctx\.setTransform\(dpr, 0, 0, dpr, 0, 0\)/);
  assert.match(app, /window\.addEventListener\("resize", sizeCanvas\)/);
  assert.ok(app.indexOf("sizeCanvas();") < app.indexOf("requestAnimationFrame(loop);\n})();"));
});
