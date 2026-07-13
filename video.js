// Sit Well — live posture coach
// Tracks eye + shoulder position via PoseNet, converts drift into a 0-100
// posture score, draws a live skeleton overlay, and gives text guidance +
// a session history graph instead of a plain on/off beep.

let video;
let poseNet;
let poses = [];

let started = false;
let baseline = null;        // { eyeMidY, shoulderMidY, eyeMidX }
let currentScore = 100;
let history = [];           // rolling score history for the sparkline
const HISTORY_MAX = 90;     // ~ last 90 samples

let badPostureSince = null; // timestamp when bad posture started, for sustained-alert logic
const BAD_ALERT_DELAY_MS = 1800;
const ALARM_REPEAT_MS = 4500; // calmer repeat cadence
let alarmActive = false;
let chimeIntervalId = null;

let smoothedScore = 100;      // exponential moving average -- kills PoseNet jitter
const SMOOTHING = 0.12;       // lower = smoother/slower to react, higher = twitchier

let calibrationSamples = [];
const CALIBRATION_FRAMES = 40; // ~1.3s at 30fps -- average several frames, not just one

const RING_CIRCUMFERENCE = 2 * Math.PI * 52;

// --- Gentle chime, generated in code (no audio file needed) ---
// A soft two-note rising tone, like a phone notification, played every
// few seconds while posture stays bad -- not a harsh continuous loop.
let audioCtx = null;

function ensureAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function playChime() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const notes = [523.25, 659.25]; // C5, E5

  notes.forEach((freq, i) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;

    const start = now + i * 0.16;
    const dur = 0.22;

    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.15, start + 0.03); // gentle fade in, low volume
    gain.gain.linearRampToValueAtTime(0, start + dur);      // soft fade out

    osc.connect(gain).connect(audioCtx.destination);
    osc.start(start);
    osc.stop(start + dur + 0.02);
  });
}

function setup() {
  const canvas = createCanvas(480, 360);
  canvas.parent('video');

  video = createCapture(VIDEO);
  video.size(480, 360);
  video.hide();

  poseNet = ml5.poseNet(video, () => {
    setStatus('Camera ready — click Start');
  });
  poseNet.on('pose', (results) => {
    poses = results;
  });

  noLoop();
  drawHistoryGraph();
}

function draw() {
  background(16, 36, 31);
  if (video) image(video, 0, 0, width, height);

  if (poses.length > 0) {
    drawSkeleton(poses[0].pose);
    if (started) evaluatePosture(poses[0].pose);
  }
}

function drawSkeleton(pose) {
  const pts = [pose.leftEye, pose.rightEye, pose.leftShoulder, pose.rightShoulder];
  noStroke();
  pts.forEach((p) => {
    if (!p) return;
    fill(started ? scoreColor(currentScore) : '#8fb8b0');
    ellipse(p.x, p.y, 9, 9);
  });

  if (pose.leftShoulder && pose.rightShoulder) {
    stroke(started ? scoreColor(currentScore) : '#8fb8b0');
    strokeWeight(2);
    line(pose.leftShoulder.x, pose.leftShoulder.y, pose.rightShoulder.x, pose.rightShoulder.y);
    noStroke();
  }
}

function evaluatePosture(pose) {
  const leftEye = pose.leftEye, rightEye = pose.rightEye;
  const leftSh = pose.leftShoulder, rightSh = pose.rightShoulder;
  if (!leftEye || !rightEye || !leftSh || !rightSh) return;

  const eyeMidY = (leftEye.y + rightEye.y) / 2;
  const eyeMidX = (leftEye.x + rightEye.x) / 2;
  const shoulderMidY = (leftSh.y + rightSh.y) / 2;

  // Calibration: average several frames instead of trusting one noisy reading
  if (!baseline) {
    calibrationSamples.push({ eyeMidY, eyeMidX, shoulderMidY });
    setStatus(`Calibrating... (${calibrationSamples.length}/${CALIBRATION_FRAMES})`);
    if (calibrationSamples.length >= CALIBRATION_FRAMES) {
      const n = calibrationSamples.length;
      baseline = {
        eyeMidY: calibrationSamples.reduce((s, c) => s + c.eyeMidY, 0) / n,
        eyeMidX: calibrationSamples.reduce((s, c) => s + c.eyeMidX, 0) / n,
        shoulderMidY: calibrationSamples.reduce((s, c) => s + c.shoulderMidY, 0) / n,
      };
      smoothedScore = 100;
      setStatus('Calibrated — tracking your posture');
    }
    return;
  }

  // Slouching forward/down shows up as eyes dropping relative to shoulders,
  // leaning left/right shows up as horizontal eye drift.
  const verticalDrift = Math.abs(eyeMidY - baseline.eyeMidY);
  const horizontalDrift = Math.abs(eyeMidX - baseline.eyeMidX);
  const drift = verticalDrift * 1.1 + horizontalDrift * 0.7;

  // Raw per-frame score (still noisy) ...
  const rawScore = constrain(100 - drift * 1.3, 0, 100);
  // ...smoothed with an exponential moving average so single-frame jitter
  // from PoseNet can't swing the alarm on and off.
  smoothedScore = smoothedScore + SMOOTHING * (rawScore - smoothedScore);
  const score = Math.round(smoothedScore);
  currentScore = score;

  updateScoreRing(score);
  pushHistory(score);
  updateGuidance(score, verticalDrift, horizontalDrift);
  handleAlarmTiming(score);
}

function updateScoreRing(score) {
  const ring = document.getElementById('ringFill');
  const label = document.getElementById('scoreValue');
  const offset = RING_CIRCUMFERENCE * (1 - score / 100);
  ring.style.strokeDashoffset = offset;
  ring.style.stroke = scoreColor(score);
  label.textContent = score;
}

function scoreColor(score) {
  if (score >= 75) return '#6B9A78';  // good
  if (score >= 45) return '#D6A24C';  // warn
  return '#E4572E';                    // bad
}

function updateGuidance(score, vDrift, hDrift) {
  const headline = document.getElementById('guidanceHeadline');
  const detail = document.getElementById('guidanceDetail');

  if (score >= 75) {
    headline.textContent = 'Nice — you\'re sitting well';
    headline.style.color = 'var(--good)';
    detail.textContent = 'Keep your shoulders level and eyes at this height. This is your target.';
  } else if (score >= 45) {
    headline.textContent = vDrift > hDrift ? 'You\'re starting to slouch' : 'You\'ve drifted sideways';
    headline.style.color = 'var(--warn)';
    detail.textContent = vDrift > hDrift
      ? 'Lift your chest and roll your shoulders back slightly.'
      : 'Shift back toward the center of your chair.';
  } else {
    headline.textContent = vDrift > hDrift ? 'Sit up straight' : 'Move back to center';
    headline.style.color = 'var(--bad)';
    detail.textContent = vDrift > hDrift
      ? 'Your head has dropped well below your baseline — straighten up and bring your eyes level.'
      : 'You\'ve leaned well off to one side — recenter yourself in front of the camera.';
  }
}

function pushHistory(score) {
  history.push(score);
  if (history.length > HISTORY_MAX) history.shift();
  drawHistoryGraph();
}

function drawHistoryGraph() {
  const canvas = document.getElementById('historyCanvas');
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  // gridlines
  ctx.strokeStyle = '#E4DFD3';
  ctx.lineWidth = 1;
  for (let gy = 0; gy <= 4; gy++) {
    const y = (h / 4) * gy;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  if (history.length < 2) return;

  ctx.beginPath();
  history.forEach((s, i) => {
    const x = (i / (HISTORY_MAX - 1)) * w;
    const y = h - (s / 100) * h;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  const last = history[history.length - 1];
  ctx.strokeStyle = scoreColor(last);
  ctx.lineWidth = 2;
  ctx.stroke();
}

function handleAlarmTiming(score) {
  const now = Date.now();
  if (score < 45) {
    if (!badPostureSince) badPostureSince = now;
    if (now - badPostureSince > BAD_ALERT_DELAY_MS && !alarmActive) {
      triggerAlarm();
    }
  } else {
    badPostureSince = null;
    if (alarmActive) clearAlarm();
  }
}

function triggerAlarm() {
  alarmActive = true;
  document.getElementById('scoreRingWrap').style.filter = 'drop-shadow(0 0 6px #E4572E)';
  playChime();
  chimeIntervalId = setInterval(playChime, ALARM_REPEAT_MS); // gentle nudge, not continuous
  setStatus('Correct your posture');
}

function clearAlarm() {
  alarmActive = false;
  document.getElementById('scoreRingWrap').style.filter = 'none';
  if (chimeIntervalId) {
    clearInterval(chimeIntervalId);
    chimeIntervalId = null;
  }
  setStatus('Tracking your posture');
}

function setStatus(text) {
  document.getElementById('statusPill').textContent = text;
}

function start() {
  ensureAudioContext(); // must happen on a user click for browsers to allow sound
  started = true;
  baseline = null;
  calibrationSamples = [];
  history = [];
  badPostureSince = null;
  clearAlarm();
  setStatus('Calibrating...');
  loop();
}

function stop() {
  started = false;
  baseline = null;
  calibrationSamples = [];
  clearAlarm();
  setStatus('Camera idle');
  document.getElementById('guidanceHeadline').textContent = 'Click Start to calibrate';
  document.getElementById('guidanceHeadline').style.color = 'var(--ink)';
  document.getElementById('guidanceDetail').textContent = 'Sit the way you normally would — that becomes your baseline. Sit Well tracks how far you drift from it.';
}
