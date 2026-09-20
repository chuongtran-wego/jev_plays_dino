(() => {
  "use strict";

  const canvas = document.getElementById("game-canvas");
  const ctx = canvas.getContext("2d");
  const els = Object.fromEntries([
    "engine-label", "engine-badge", "player-label", "canvas-score", "canvas-speed",
    "game-over", "final-score", "sound-button", "sound-label", "pause-button", "reset-button", "try-again-button",
    "jump-key", "duck-key", "input-state", "decision-action", "confidence", "latency",
    "jump-bar", "continue-bar", "duck-bar", "jump-probability", "continue-probability",
    "duck-probability", "state-obstacle", "state-distance", "state-speed", "state-risk",
    "decision-log", "clear-log", "footer-score", "passed-count", "average-latency", "decision-count"
  ].map(id => [id, document.getElementById(id)]));

  const WIDTH = 960;
  const HEIGHT = 500;
  const GROUND = 390;
  const DINO_X = 108;
  const BASE_SPEED = 6;
  const MAX_SPEED_GAIN = 5.5;
  const GRAVITY = 0.72;
  const JUMP_VELOCITY = -14.2;

  let mode = "jev";
  let paused = false;
  let gameOver = false;
  let score = 0;
  let passed = 0;
  let speed = BASE_SPEED;
  let gameSpeed = 1;
  let frame = 0;
  let nextSpawn = 70;
  let obstacleCounter = 0;
  let pendingDecision = false;
  let activeInput = "continue";
  let duckUntil = 0;
  let logs = [];
  let latencies = [];
  let gameSession = 0;
  let engine = "connecting";
  let lastTimestamp = performance.now();
  let audioContext = null;
  let audioUnlocked = false;
  let soundEnabled = readSoundPreference();

  const dino = { x: DINO_X, y: GROUND - 56, width: 48, height: 56, vy: 0, onGround: true, ducking: false };
  let obstacles = [];

  function readSoundPreference() {
    try {
      return localStorage.getItem("jev-dino-sound") !== "off";
    } catch {
      return true;
    }
  }

  function saveSoundPreference() {
    try {
      localStorage.setItem("jev-dino-sound", soundEnabled ? "on" : "off");
    } catch {
      // Local storage can be unavailable in private browser contexts.
    }
  }

  function ensureAudio() {
    if (!audioContext) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return null;
      audioContext = new AudioContext();
    }
    if (audioContext.state === "suspended") audioContext.resume();
    return audioContext;
  }

  function tone({ frequency, endFrequency = frequency, duration = .08, delay = 0, type = "square", volume = .055 }) {
    if (!soundEnabled) return;
    const audio = ensureAudio();
    if (!audio) return;
    const start = audio.currentTime + delay;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(40, endFrequency), start + duration);
    gain.gain.setValueAtTime(.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + .01);
    gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + .02);
  }

  function playSound(name) {
    if (!audioUnlocked) return;
    if (name === "jump") {
      tone({ frequency: 390, endFrequency: 680, duration: .11, type: "square", volume: .045 });
    } else if (name === "duck") {
      tone({ frequency: 240, endFrequency: 130, duration: .09, type: "triangle", volume: .06 });
    } else if (name === "pass") {
      tone({ frequency: 650, duration: .06, type: "square", volume: .035 });
      tone({ frequency: 860, duration: .08, delay: .055, type: "square", volume: .035 });
    } else if (name === "crash") {
      tone({ frequency: 170, endFrequency: 48, duration: .34, type: "sawtooth", volume: .075 });
      tone({ frequency: 95, endFrequency: 55, duration: .28, delay: .04, type: "square", volume: .045 });
    } else if (name === "start") {
      tone({ frequency: 440, duration: .06, type: "square", volume: .035 });
      tone({ frequency: 660, duration: .08, delay: .07, type: "square", volume: .035 });
    } else if (name === "toggle") {
      tone({ frequency: 560, endFrequency: 720, duration: .07, type: "sine", volume: .04 });
    }
  }

  function updateSoundButton() {
    els["sound-label"].textContent = soundEnabled ? "Sound" : "Muted";
    els["sound-button"].firstChild.textContent = soundEnabled ? "♫ " : "× ";
    els["sound-button"].setAttribute("aria-label", soundEnabled ? "Mute sound" : "Turn sound on");
    els["sound-button"].setAttribute("title", soundEnabled ? "Mute sound" : "Turn sound on");
    els["sound-button"].classList.toggle("muted", !soundEnabled);
  }

  function unlockAudio() {
    audioUnlocked = true;
    if (soundEnabled) ensureAudio();
  }

  function resetGame() {
    gameSession++;
    paused = false;
    gameOver = false;
    score = 0;
    passed = 0;
    speed = BASE_SPEED * gameSpeed;
    frame = 0;
    nextSpawn = 150;
    obstacles = [];
    obstacleCounter = 0;
    spawnObstacle();
    obstacles[0].x = 620;
    pendingDecision = false;
    activeInput = "continue";
    duckUntil = 0;
    dino.y = GROUND - 56;
    dino.vy = 0;
    dino.onGround = true;
    dino.ducking = false;
    clearDecisionHistory();
    els["game-over"].classList.add("hidden");
    els["pause-button"].innerHTML = "Ⅱ <span>Pause</span>";
    updateInputUI("continue");
    updateMetrics();
    playSound("start");
  }

  function setMode(nextMode) {
    mode = nextMode;
    document.querySelectorAll(".mode-button").forEach(button => {
      button.classList.toggle("active", button.dataset.mode === mode);
    });
    const names = { human: "HUMAN IS PLAYING", rule: "RULE BOT IS PLAYING", jev: "JEV IS PLAYING" };
    els["player-label"].textContent = names[mode];
    if (mode !== "jev") {
      els["engine-badge"].textContent = mode === "rule" ? "LOCAL RULES" : "KEYBOARD";
      els["engine-badge"].classList.remove("live");
    } else {
      setEngineBadge();
    }
    resetGame();
  }

  function setGameSpeed(multiplier) {
    if (![1, 2, 3].includes(multiplier)) return;
    gameSpeed = multiplier;
    document.querySelectorAll(".speed-button").forEach(button => {
      button.classList.toggle("active", Number(button.dataset.speed) === gameSpeed);
    });
    resetGame();
  }

  function effectiveSpeed() {
    return speed;
  }

  function jump() {
    if (!dino.onGround || gameOver || paused) return;
    dino.vy = JUMP_VELOCITY;
    dino.onGround = false;
    dino.ducking = false;
    pulseInput("jump", 180);
    playSound("jump");
  }

  function duck(duration = 480) {
    if (gameOver || paused) return;
    const startedDucking = !dino.ducking;
    duckUntil = performance.now() + duration;
    dino.ducking = true;
    if (startedDucking) {
      pulseInput("duck", duration);
      playSound("duck");
    } else {
      updateInputUI("duck");
    }
  }

  function executeAction(action) {
    if (action === "jump") jump();
    else if (action === "duck") duck();
    else updateInputUI("continue");
  }

  function pulseInput(action, duration) {
    updateInputUI(action);
    window.setTimeout(() => {
      if (activeInput === action) updateInputUI("continue");
    }, duration);
  }

  function updateInputUI(action) {
    activeInput = action;
    els["jump-key"].classList.toggle("active", action === "jump");
    els["duck-key"].classList.toggle("active", action === "duck");
    els["input-state"].textContent = action === "continue" ? "RUNNING" : action.toUpperCase();
  }

  function spawnObstacle() {
    const roll = Math.random();
    let type;
    if (score > 180 && roll > 0.74) type = Math.random() > 0.45 ? "bird_low" : "bird_high";
    else type = roll > 0.43 ? "cactus_large" : "cactus_small";

    const isBird = type.startsWith("bird");
    const dimensions = type === "cactus_large" ? [36, 66] : type === "cactus_small" ? [25, 46] : [52, 30];
    let y = GROUND - dimensions[1];
    if (type === "bird_low") y = GROUND - 68;
    if (type === "bird_high") y = GROUND - 108;
    obstacles.push({
      id: `obstacle-${++obstacleCounter}`,
      type, x: WIDTH + 20, y, width: dimensions[0], height: dimensions[1],
      passed: false, lastAskedDistance: Infinity, wing: 0, isBird
    });
  }

  function nearestObstacle() {
    return obstacles.find(obstacle => obstacle.x + obstacle.width >= dino.x) || null;
  }

  function ruleDecision(obstacle) {
    if (!obstacle) return "continue";
    const distance = Math.max(0, obstacle.x - (dino.x + dino.width));
    const framesToCollision = distance / Math.max(speed, 1);

    if (obstacle.type.startsWith("cactus")) {
      // Jump late enough that the dinosaur stays airborne until the cactus's
      // trailing edge has cleared its collision box. An earlier jump can look
      // correct but land on wide cacti before they have fully passed.
      if (dino.onGround && framesToCollision <= 18) return "jump";
      return "continue";
    }

    if (obstacle.type === "bird_low" && framesToCollision <= 25) {
      const clearDistance = distance + obstacle.width + dino.width + 18;
      const holdDuration = Math.max(260, clearDistance / Math.max(effectiveSpeed() * 60, 1) * 1000);
      return { action: "duck", duration: holdDuration };
    }

    return "continue";
  }

  function executeRuleDecision(obstacle) {
    const decision = ruleDecision(obstacle);
    if (typeof decision === "string") {
      executeAction(decision);
      return;
    }
    duck(decision.duration);
  }

  async function requestJevDecision(obstacle) {
    if (!obstacle || pendingDecision || gameOver || paused) return;
    const requestSession = gameSession;
    const distance = Math.max(0, obstacle.x - (dino.x + dino.width));
    const lookahead = 430 + effectiveSpeed() * 8;
    if (distance > lookahead || obstacle.lastAskedDistance - distance < 52) return;
    obstacle.lastAskedDistance = distance;
    pendingDecision = true;
    const started = performance.now();
    const state = {
      speed: Number(effectiveSpeed().toFixed(2)),
      score: Math.floor(score),
      dino_state: dino.onGround ? (dino.ducking ? "ducking" : "running") : "jumping",
      time_to_collision_ms: Math.round(distance / (effectiveSpeed() * 60) * 1000),
      obstacle: {
        id: obstacle.id,
        type: obstacle.type,
        distance: Math.round(distance),
        width: obstacle.width,
        height: obstacle.height,
        y: obstacle.y
      }
    };
    try {
      const response = await fetch("/api/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const decision = await response.json();
      if (requestSession !== gameSession) return;
      decision.latency_ms = decision.latency_ms || Math.round(performance.now() - started);
      showDecision(decision, state);
      if (nearestObstacle()?.id === decision.obstacle_id) executeAction(decision.action);
    } catch (error) {
      if (requestSession !== gameSession) return;
      const rule = ruleDecision(obstacle);
      const action = typeof rule === "string" ? rule : rule.action;
      const fallback = {
        obstacle_id: obstacle.id,
        action,
        probabilities: action === "jump"
          ? { jump: .91, duck: .02, continue: .07 }
          : action === "duck"
            ? { jump: .05, duck: .89, continue: .06 }
            : { jump: .06, duck: .03, continue: .91 },
        confidence: .91,
        collision_risk: distance < 160 ? 4 : 1,
        latency_ms: Math.round(performance.now() - started),
        engine: "browser simulation"
      };
      showDecision(fallback, state);
      if (nearestObstacle()?.id === obstacle.id) executeAction(action);
    } finally {
      if (requestSession === gameSession) pendingDecision = false;
    }
  }

  function showDecision(decision, state) {
    const probabilities = decision.probabilities || { jump: 0, duck: 0, continue: 1 };
    const action = decision.action || "continue";
    const risk = Number(decision.collision_risk || 0);
    engine = decision.engine || engine;
    els["decision-action"].textContent = action.toUpperCase();
    els.confidence.textContent = `${Math.round((decision.confidence || 0) * 100)}%`;
    els.latency.textContent = `${decision.latency_ms} ms`;
    setProbability("jump", probabilities.jump || 0);
    setProbability("continue", probabilities.continue || 0);
    setProbability("duck", probabilities.duck || 0);
    els["state-obstacle"].textContent = state.obstacle.type;
    els["state-distance"].textContent = `${state.obstacle.distance} px`;
    els["state-speed"].textContent = state.speed.toFixed(1);
    updateRisk(risk);
    latencies.push(decision.latency_ms);
    addLog(action, decision.confidence || 0, decision.latency_ms);
    setEngineBadge();
    updateMetrics();
  }

  function setProbability(name, value) {
    const percentage = Math.round(value * 100);
    els[`${name}-bar`].style.width = `${percentage}%`;
    els[`${name}-probability`].textContent = `${percentage}%`;
  }

  function updateRisk(scoreValue) {
    const label = scoreValue >= 3.5 ? "HIGH" : scoreValue >= 2 ? "MEDIUM" : "LOW";
    els["state-risk"].textContent = label;
    els["state-risk"].className = `risk-${label.toLowerCase()}`;
  }

  function addLog(action, confidence, latency) {
    logs.unshift({ time: timestamp(), action, confidence: Math.round(confidence * 100), latency });
    logs = logs.slice(0, 8);
    renderLogs();
  }

  function timestamp() {
    const elapsed = Math.floor(frame / 60 * 1000);
    const minutes = String(Math.floor(elapsed / 60000)).padStart(2, "0");
    const seconds = String(Math.floor(elapsed / 1000) % 60).padStart(2, "0");
    const millis = String(elapsed % 1000).padStart(3, "0");
    return `${minutes}:${seconds}.${millis}`;
  }

  function renderLogs() {
    if (!logs.length) {
      els["decision-log"].innerHTML = '<div class="empty-log">Waiting for the first obstacle…</div>';
      return;
    }
    els["decision-log"].innerHTML = logs.map(item => `
      <div class="log-entry">
        <i class="log-dot"></i><span>${item.time}</span><strong class="log-action">${item.action.toUpperCase()}</strong>
        <span>${item.confidence}%</span><span>${item.latency} ms</span>
      </div>`).join("");
  }

  function clearDecisionHistory() {
    logs = [];
    latencies = [];
    renderLogs();
    updateMetrics();
  }

  function setEngineBadge() {
    if (mode !== "jev") return;
    const text = engine === "jev" ? "JEV LIVE" : engine === "connecting" ? "CONNECTING" : "SIMULATION";
    els["engine-badge"].textContent = text;
    els["engine-badge"].classList.toggle("live", engine === "jev");
    els["engine-label"].textContent = engine === "jev" ? "JEV AUTOPILOT" : "AI AUTOPILOT";
  }

  async function loadEngineStatus() {
    try {
      const response = await fetch("/api/health");
      const status = await response.json();
      engine = status.engine || "simulation";
    } catch {
      engine = "browser simulation";
    }
    setEngineBadge();
  }

  function updateGame(delta) {
    if (paused || gameOver) return;
    frame += delta;
    score += 0.12 * delta;
    const startingSpeed = BASE_SPEED * gameSpeed;
    speed = Math.min(startingSpeed + MAX_SPEED_GAIN, startingSpeed + score / 500);
    if (frame >= nextSpawn) {
      spawnObstacle();
      nextSpawn = frame + Math.round(115 + Math.random() * 85 - speed * 2);
    }

    if (!dino.onGround) {
      dino.vy += GRAVITY * delta;
      dino.y += dino.vy * delta;
      if (dino.y >= GROUND - 56) {
        dino.y = GROUND - 56;
        dino.vy = 0;
        dino.onGround = true;
      }
    }
    if (performance.now() > duckUntil) dino.ducking = false;

    obstacles.forEach(obstacle => {
      obstacle.x -= speed * delta;
      obstacle.wing = Math.floor(frame / 9) % 2;
      if (!obstacle.passed && obstacle.x + obstacle.width < dino.x) {
        obstacle.passed = true;
        passed++;
        playSound("pass");
      }
    });
    obstacles = obstacles.filter(obstacle => obstacle.x + obstacle.width > -20);

    const nearest = nearestObstacle();
    if (nearest) {
      const distance = Math.max(0, nearest.x - (dino.x + dino.width));
      els["state-obstacle"].textContent = nearest.type;
      els["state-distance"].textContent = `${Math.round(distance)} px`;
      if (mode === "rule") executeRuleDecision(nearest);
      if (mode === "jev") requestJevDecision(nearest);
    } else {
      els["state-obstacle"].textContent = "none";
      els["state-distance"].textContent = "—";
    }

    if (obstacles.some(collides)) endGame();
    updateMetrics();
  }

  function collides(obstacle) {
    const ducking = dino.ducking && dino.onGround;
    const box = {
      x: dino.x + 8,
      y: ducking ? GROUND - 31 : dino.y + 7,
      width: ducking ? 51 : 35,
      height: ducking ? 25 : 47
    };
    const obstacleBox = { x: obstacle.x + 4, y: obstacle.y + 3, width: obstacle.width - 8, height: obstacle.height - 5 };
    return box.x < obstacleBox.x + obstacleBox.width &&
      box.x + box.width > obstacleBox.x &&
      box.y < obstacleBox.y + obstacleBox.height &&
      box.y + box.height > obstacleBox.y;
  }

  function endGame() {
    gameOver = true;
    playSound("crash");
    els["final-score"].textContent = `Score ${Math.floor(score)}`;
    els["game-over"].classList.remove("hidden");
    updateInputUI("continue");
  }

  function updateMetrics() {
    const wholeScore = Math.floor(score);
    els["canvas-score"].textContent = String(wholeScore).padStart(5, "0");
    els["canvas-speed"].textContent = `${(speed / BASE_SPEED).toFixed(1)}×`;
    els["state-speed"].textContent = effectiveSpeed().toFixed(1);
    els["footer-score"].textContent = wholeScore;
    els["passed-count"].textContent = passed;
    els["decision-count"].textContent = logs.length ? latencies.length : 0;
    const average = latencies.length ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length) : null;
    els["average-latency"].textContent = average === null ? "—" : `${average} ms`;
  }

  function draw() {
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = "#f3f0e8";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    drawCloud(180 - frame * .12 % 1100, 142, 1);
    drawCloud(660 - frame * .08 % 1200, 105, .82);
    drawCloud(870 - frame * .14 % 1300, 205, .65);
    drawGround();
    const nearest = nearestObstacle();
    if (mode === "jev" && nearest && nearest.x < 570) drawSensing(nearest);
    obstacles.forEach(drawObstacle);
    drawDino();
  }

  function drawGround() {
    ctx.fillStyle = "#303638";
    ctx.fillRect(0, GROUND, WIDTH, 3);
    for (let i = 0; i < 28; i++) {
      const x = ((i * 67 - frame * speed * .7) % (WIDTH + 60) + WIDTH + 60) % (WIDTH + 60) - 30;
      const y = GROUND + 18 + (i * 17 % 34);
      ctx.fillRect(x, y, i % 3 === 0 ? 7 : 3, 3);
    }
  }

  function drawCloud(x, y, scale) {
    if (x < -120) x += 1200;
    ctx.strokeStyle = "#a1a39f";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, y + 20 * scale);
    ctx.lineTo(x + 22 * scale, y + 20 * scale);
    ctx.quadraticCurveTo(x + 29 * scale, y, x + 43 * scale, y + 10 * scale);
    ctx.quadraticCurveTo(x + 60 * scale, y - 8 * scale, x + 73 * scale, y + 11 * scale);
    ctx.lineTo(x + 98 * scale, y + 20 * scale);
    ctx.stroke();
  }

  function drawSensing(obstacle) {
    const startX = dino.x + 38;
    const startY = dino.y + 28;
    ctx.save();
    ctx.strokeStyle = "rgba(32, 179, 101, .55)";
    ctx.fillStyle = "rgba(82, 245, 154, .055)";
    ctx.setLineDash([7, 7]);
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(obstacle.x + obstacle.width / 2, obstacle.y - 16);
    ctx.lineTo(obstacle.x + obstacle.width / 2, GROUND + 10);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = "#36db82";
    ctx.lineWidth = 3;
    const x = obstacle.x - 8, y = obstacle.y - 9, w = obstacle.width + 16, h = obstacle.height + 18;
    const corner = 12;
    [[x,y,1,1],[x+w,y,-1,1],[x,y+h,1,-1],[x+w,y+h,-1,-1]].forEach(([cx,cy,sx,sy]) => {
      ctx.beginPath(); ctx.moveTo(cx + sx * corner, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + sy * corner); ctx.stroke();
    });
    const distance = Math.max(0, Math.round(obstacle.x - (dino.x + dino.width)));
    ctx.fillStyle = "#253032";
    ctx.font = "700 14px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText(`${distance} px`, obstacle.x + obstacle.width / 2, obstacle.y - 24);
    ctx.restore();
  }

  function drawDino() {
    ctx.save();
    ctx.fillStyle = "#252b2d";
    const x = dino.x;
    if (dino.ducking && dino.onGround) {
      const y = GROUND - 30;
      ctx.fillRect(x + 4, y + 7, 42, 20);
      ctx.fillRect(x + 37, y, 27, 22);
      ctx.fillRect(x + 55, y + 5, 7, 6);
      ctx.fillStyle = "#f3f0e8"; ctx.fillRect(x + 53, y + 4, 4, 4);
      ctx.fillStyle = "#252b2d";
      ctx.fillRect(x, y + 13, 12, 7);
      ctx.fillRect(x + 13, y + 25, 8, 6);
      ctx.fillRect(x + 38, y + 25, 8, 6);
    } else {
      const y = dino.y;
      ctx.fillRect(x + 24, y, 28, 24);
      ctx.fillRect(x + 17, y + 17, 30, 23);
      ctx.fillRect(x + 11, y + 29, 27, 16);
      ctx.fillRect(x + 4, y + 35, 13, 8);
      ctx.fillRect(x, y + 31, 8, 7);
      ctx.fillRect(x + 30, y + 37, 7, 17);
      ctx.fillRect(x + 16, y + 41, 7, frame % 12 < 6 ? 15 : 10);
      ctx.fillStyle = "#f3f0e8";
      ctx.fillRect(x + 42, y + 6, 4, 4);
      ctx.fillRect(x + 42, y + 17, 10, 4);
    }
    ctx.restore();
  }

  function drawObstacle(obstacle) {
    ctx.fillStyle = "#313739";
    if (obstacle.isBird) {
      const x = obstacle.x, y = obstacle.y;
      ctx.fillRect(x + 13, y + 9, 29, 16);
      ctx.fillRect(x + 37, y + 13, 15, 7);
      ctx.fillRect(x + 5, y + 12, 12, 7);
      if (obstacle.wing) {
        ctx.fillRect(x + 17, y, 20, 10);
      } else {
        ctx.fillRect(x + 17, y + 21, 20, 9);
      }
      ctx.fillStyle = "#f3f0e8";
      ctx.fillRect(x + 39, y + 11, 3, 3);
      return;
    }
    const x = obstacle.x, y = obstacle.y, h = obstacle.height;
    const trunkWidth = obstacle.type === "cactus_large" ? 15 : 11;
    const trunkX = x + Math.floor((obstacle.width - trunkWidth) / 2);
    ctx.fillRect(trunkX, y, trunkWidth, h);
    ctx.fillRect(trunkX - 10, y + h * .38, 10, 9);
    ctx.fillRect(trunkX - 14, y + h * .22, 6, h * .25);
    ctx.fillRect(trunkX + trunkWidth, y + h * .48, 10, 9);
    ctx.fillRect(trunkX + trunkWidth + 8, y + h * .31, 6, h * .27);
  }

  function loop(timestamp) {
    const delta = Math.min(12, Math.max(0.25, (timestamp - lastTimestamp) / 16.67));
    lastTimestamp = timestamp;
    const stepCount = Math.ceil(delta * Math.max(1, speed / BASE_SPEED));
    const stepDelta = delta / stepCount;
    for (let step = 0; step < stepCount && !gameOver; step++) updateGame(stepDelta);
    draw();
    requestAnimationFrame(loop);
  }

  document.querySelectorAll(".mode-button").forEach(button => button.addEventListener("click", () => setMode(button.dataset.mode)));
  document.querySelectorAll(".speed-button").forEach(button => button.addEventListener("click", () => setGameSpeed(Number(button.dataset.speed))));
  els["sound-button"].addEventListener("click", () => {
    const wasEnabled = soundEnabled;
    soundEnabled = !soundEnabled;
    saveSoundPreference();
    updateSoundButton();
    if (!wasEnabled && soundEnabled) playSound("toggle");
  });
  els["pause-button"].addEventListener("click", () => {
    if (gameOver) return;
    paused = !paused;
    els["pause-button"].innerHTML = paused ? "▶ <span>Resume</span>" : "Ⅱ <span>Pause</span>";
  });
  els["reset-button"].addEventListener("click", resetGame);
  els["try-again-button"].addEventListener("click", resetGame);
  els["clear-log"].addEventListener("click", clearDecisionHistory);
  window.addEventListener("keydown", event => {
    if (event.code === "Space" || event.code === "ArrowUp" || event.code === "ArrowDown") event.preventDefault();
    if (mode !== "human") return;
    if (event.code === "Space" || event.code === "ArrowUp") jump();
    if (event.code === "ArrowDown") duck(180);
  });
  window.addEventListener("keyup", event => {
    if (mode === "human" && event.code === "ArrowDown") {
      duckUntil = 0;
      dino.ducking = false;
      updateInputUI("continue");
    }
  });

  document.addEventListener("pointerdown", unlockAudio, { once: true });
  document.addEventListener("keydown", unlockAudio, { once: true });

  loadEngineStatus();
  updateSoundButton();
  resetGame();
  requestAnimationFrame(loop);
})();
