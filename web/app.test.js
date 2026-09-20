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
  const spawnObstacle = app.match(/function spawnObstacle\([^\n]*\)\s*\{([\s\S]*?)\n  \}/)?.[1] || "";

  assert.match(resetGame, /spawnWave\(\)/);
  assert.doesNotMatch(resetGame, /obstacles\[0\]\.x\s*=/);
  assert.match(app, /function spawnObstacle\(\{[^}]*x = WIDTH \+ 20/);
  assert.match(spawnObstacle, /type, x, y,/);
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

function constant(name) {
  return Number(app.match(new RegExp(`const ${name} = (-?[\\d.]+);`))?.[1]);
}

function objectLiteral(name) {
  const source = app.match(new RegExp(`${name}(?: =|:)\\s*\\{([^}]+)\\}`))?.[1] || "";
  return Object.fromEntries([...source.matchAll(/(\w+):\s*(-?[\d.]+)/g)].map(match => [match[1], Number(match[2])]));
}

function canvasAttributes() {
  return html.match(/<canvas id="game-canvas" width="(\d+)" height="(\d+)"/).slice(1).map(Number);
}

function obstacleSize(type) {
  return app.match(new RegExp(`${type}: \\[(\\d+), (\\d+)\\]`)).slice(1).map(Number);
}

const dinoSprite = objectLiteral("const dino");
const standingHitbox = objectLiteral("standing");
const obstacleInset = objectLiteral("OBSTACLE_HITBOX_INSET");

// Mirrors HITBOX_OVERLAP_EXTRA: run-in plus run-out of the standing hitbox around an obstacle.
function hitboxOverlapExtra() {
  return 2 * dinoSprite.width - 2 * standingHitbox.left - standingHitbox.width;
}

// Mirrors arcWindowFrames(): frames the standing hitbox stays above a cactus of this height.
function arcWindowFrames(height) {
  const gravity = constant("GRAVITY");
  const clearance = height - obstacleInset.top - (dinoSprite.height - standingHitbox.top - standingHitbox.height);
  return 2 * Math.sqrt(constant("JUMP_VELOCITY") ** 2 - 2 * gravity * clearance) / gravity;
}

// Mirrors jumpSpanLimit(): widest obstacle span one jump clears at this speed.
function jumpSpanLimit(height, speed) {
  return (arcWindowFrames(height) - 2 * constant("ARC_MARGIN_FRAMES")) * speed - hitboxOverlapExtra();
}

test("game canvas keeps its intrinsic wide ratio instead of stretching to the panel", () => {
  const canvasRule = cssRule("#game-canvas");
  const [width, height] = canvasAttributes();

  assert.match(canvasRule, /height:\s*auto\b/);
  assert.doesNotMatch(canvasRule, /height:\s*100%|min-height|aspect-ratio/);
  assert.doesNotMatch(styles, /\.game-panel[^{]*\{[^}]*(min-height|flex:\s*1)/);
  assert.ok(width / height >= 3.5, "canvas should stay close to the 4:1 strip of the Chrome game");
});

test("canvas constants match the markup and keep the scene inside the frame", () => {
  const [width, height] = canvasAttributes();
  const jumpApex = constant("GROUND") - dinoSprite.height - constant("JUMP_VELOCITY") ** 2 / (2 * constant("GRAVITY"));
  // drawGround places its lowest dots at GROUND + 35 with a 3 px height.
  const groundTextureDepth = 38;

  assert.equal(constant("WIDTH"), width);
  assert.equal(constant("HEIGHT"), height);
  assert.ok(jumpApex >= 0, `jump apex at y=${jumpApex} is clipped by the top edge`);
  assert.ok(constant("GROUND") + groundTextureDepth <= height, "ground texture is clipped by the bottom edge");
  assert.match(cssRule(".game-badge"), /top:\s*calc\(var\(--ground-line\) \+ \d+px\)/);
  assert.match(app, /"--ground-line", `\$\{\(GROUND \/ HEIGHT \* 100\)/);
  assert.match(app, /drawCloud\([^,]+, GROUND - \d+, [\d.]+\)/);
  assert.doesNotMatch(app, /drawCloud\([^,]+, \d+, [\d.]+\)/);
});

test("canvas renders at device pixel ratio while CSS owns the displayed size", () => {
  const sizeCanvas = app.match(/function sizeCanvas\(\)\s*\{([\s\S]*?)\n  \}/)?.[1] || "";

  assert.match(sizeCanvas, /canvas\.width = width;/);
  assert.match(sizeCanvas, /canvas\.height = height;/);
  assert.match(sizeCanvas, /if \(canvas\.width === width && canvas\.height === height\) return;/);
  assert.match(sizeCanvas, /ctx\.setTransform\(dpr, 0, 0, dpr, 0, 0\)/);
  assert.match(app, /window\.addEventListener\("resize", sizeCanvas\)/);
  assert.ok(app.indexOf("sizeCanvas();") < app.indexOf("requestAnimationFrame(loop);\n})();"));
});

test("difficulty switch offers easy and hard with easy as the default", () => {
  assert.match(html, /class="difficulty-button active" data-difficulty="easy">Easy</);
  assert.match(html, /class="difficulty-button" data-difficulty="hard">Hard</);
  assert.match(app, /let difficulty = "easy";/);
  assert.match(app, /\["easy", "hard"\]\.includes\(level\)/);
  assert.match(app, /setDifficulty\(button\.dataset\.difficulty\)/);
  assert.match(app, /function setDifficulty\(level\)\s*\{[\s\S]*?resetGame\(\);\n  \}/);
});

test("difficulty presets hold the tuning and hard keeps single cacti out of easy", () => {
  assert.deepEqual(objectLiteral("easy"), { cactusGroupMax: 1, pairChance: 0, gapMin: 115, gapRange: 85, gapSpeedPenalty: 2 });
  assert.deepEqual(objectLiteral("hard"), { cactusGroupMax: 3, pairChance: 0.7, gapMin: 55, gapRange: 25, gapSpeedPenalty: 0 });
  assert.match(app, /nextSpawn = frame \+ spawnGapFrames\(\);/);
  assert.match(app, /count: obstacle\.count,/);
});

test("cactus clump size is derived from what the jump arc can clear", () => {
  const cactusGroupSize = app.match(/function cactusGroupSize\(type\)\s*\{([\s\S]*?)\n  \}/)?.[1] || "";
  const [largeWidth, largeHeight] = obstacleSize("cactus_large");
  const gap = constant("CACTUS_GROUP_GAP");
  const tripleWidth = 3 * largeWidth + 2 * gap;

  assert.match(cactusGroupSize, /DIFFICULTY\[difficulty\]\.cactusGroupMax/);
  assert.match(cactusGroupSize, /> jumpSpanLimit\(height\)\) maxCount--;/);
  assert.doesNotMatch(app, /CACTUS_TRIPLE_MIN_SPEED/);
  assert.ok(tripleWidth <= jumpSpanLimit(largeHeight, constant("BASE_SPEED") * 2), "a triple large clump must fit the arc at the 2x preset");
  assert.ok(tripleWidth > jumpSpanLimit(largeHeight, constant("BASE_SPEED") * 0.5), "the arc limit must actually gate clumps at low speed");
  assert.match(app, /for \(let i = 0; i < obstacle\.count; i\+\+\)/);
});

test("hard mode spacing keeps two waves in view yet leaves room to land between them", () => {
  const hard = objectLiteral("hard");
  const apex = -constant("JUMP_VELOCITY") / constant("GRAVITY");
  const airtimeFrames = 2 * apex;
  const [, largeHeight] = obstacleSize("cactus_large");
  // A paired lead is jumped with the shortest lead the arc allows; the next wave may need the longest.
  const shortestLead = apex - (arcWindowFrames(largeHeight) - 2 * constant("ARC_MARGIN_FRAMES")) / 2;
  const topPresetSpeed = constant("BASE_SPEED") + constant("MAX_SPEED_GAIN");

  assert.ok(hard.gapMin >= airtimeFrames - shortestLead + apex, "hard wave gap must let the dinosaur land and take off again");
  assert.ok((hard.gapMin + hard.gapRange) * topPresetSpeed <= constant("WIDTH"), "hard wave gap must keep two waves on screen at the 1x preset");
});

test("jump lead centres the arc over the obstacle for both the rule bot and scheduled plans", () => {
  const ruleDecision = app.match(/function ruleDecision\(obstacle\)\s*\{([\s\S]*?)\n  \}/)?.[1] || "";
  const scheduled = app.match(/function executeScheduledAction\(obstacle, action\)\s*\{([\s\S]*?)\n  \}/)?.[1] || "";

  assert.match(ruleDecision, /framesToCollision <= jumpLeadFrames\(obstacle\)/);
  assert.match(scheduled, /framesToCollision <= jumpLeadFrames\(obstacle\)/);
  assert.doesNotMatch(ruleDecision + scheduled, /framesToCollision <= 18/);
  assert.match(app, /const JUMP_APEX_FRAMES = -JUMP_VELOCITY \/ GRAVITY;/);
  assert.match(app, /const overlapPx = obstacle\.jumpSpan \+ HITBOX_OVERLAP_EXTRA;/);
});

test("hard mode pairs a trailing cactus inside one jump so two obstacles share the screen at every preset", () => {
  const spawnWave = app.match(/function spawnWave\(\)\s*\{([\s\S]*?)\n  \}/)?.[1] || "";
  const [largeWidth, largeHeight] = obstacleSize("cactus_large");
  const gapCap = constant("PAIR_GAP_MAX_SHARE") * constant("WIDTH");

  assert.match(spawnWave, /if \(lead\.isBird \|\| Math\.random\(\) >= DIFFICULTY\[difficulty\]\.pairChance\) return;/);
  assert.match(spawnWave, /if \(gapMax < PAIR_GAP_MIN\) return;/);
  assert.match(spawnWave, /spawnObstacle\(\{ type, count: 1, x: lead\.x \+ lead\.width \+ gap \}\)/);
  assert.match(spawnWave, /lead\.jumpSpan = lead\.width \+ gap \+ trailing\.width;/);
  assert.match(app, /jumpSpan: width,/);
  for (const multiplier of [1, 2, 4, 8]) {
    const speed = constant("BASE_SPEED") * multiplier;
    const gapMax = Math.min(jumpSpanLimit(largeHeight, speed) - 2 * largeWidth, gapCap);
    assert.ok(gapMax >= constant("PAIR_GAP_MIN"), `two large cacti cannot pair at the ${multiplier}x preset (gap ${gapMax.toFixed(0)} px)`);
    assert.ok(2 * largeWidth + gapMax + constant("DINO_X") < constant("WIDTH"), `a pair does not fit on screen at ${multiplier}x`);
  }
});

test("AI plans are requested for every obstacle inside the lookahead, not just the nearest", () => {
  assert.match(app, /function nextUnplannedObstacle\(\)/);
  assert.match(app, /requestJevDecision\(nextUnplannedObstacle\(\)\);/);
  assert.match(app, /scheduleJevAction\(nearest\);/);
});
