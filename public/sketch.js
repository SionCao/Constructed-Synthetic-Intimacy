const socket = io();

let connected = false;
let video;

let faceMesh = null;
let facePredictions = [];
let trackedFace = null;
let faceTrackingReady = false;
let faceTrackingStarted = false;
let faceInitAttempted = false;

let personaWords = ["latent", "curious", "shifting", "signal", "mirror", "social", "memory"];
let personaPhrases = ["becoming through interaction", "pattern seeking under pressure"];
let personaTitle = "Unresolved Persona";
let personaSummary = "Complete the questionnaire to generate a live portrait.";
let personaRecommendations = [];

const basicQuestions = [
  { key: "name", label: "What is your name?", type: "text", placeholder: "e.g. Alex" },
  { key: "pronouns", label: "What pronouns do you use?", type: "text", placeholder: "e.g. she/her, he/they" },
  { key: "age", label: "How old are you?", type: "text", placeholder: "e.g. 24" },
  { key: "nationality", label: "What is your nationality?", type: "text", placeholder: "e.g. Chinese" },
  { key: "city", label: "Which city are you living in now?", type: "text", placeholder: "e.g. London" },
  { key: "occupation", label: "What do you do currently?", type: "text", placeholder: "e.g. student, designer, developer" },
  { key: "discipline", label: "What field or discipline are you closest to?", type: "text", placeholder: "e.g. computational arts" },
  { key: "value", label: "What is one value you care about most?", type: "text", placeholder: "e.g. freedom, care, honesty" },
  { key: "habit", label: "What is one habit that feels very ‘you’?", type: "text", placeholder: "e.g. overthinking before sleeping" },
  { key: "goal", label: "What are you moving toward recently?", type: "text", placeholder: "e.g. confidence, stability, a new project" }
];

const personalityQuestions = [
  { key: "p1", label: "In a new environment, what feels more natural?", type: "single", options: ["Talking to people quickly", "Observing first and speaking later"] },
  { key: "p2", label: "When making decisions, you trust more:", type: "single", options: ["Logic and structure", "Emotion and human nuance"] },
  { key: "p3", label: "Your work style is closer to:", type: "single", options: ["Planning ahead", "Improvising as you go"] },
  { key: "p4", label: "You are usually drawn to:", type: "single", options: ["Concrete details", "Possibilities and patterns"] },
  { key: "p5", label: "In group projects you tend to:", type: "single", options: ["Take initiative and direct", "Support and adapt around others"] },
  { key: "p6", label: "Conflict makes you want to:", type: "single", options: ["Address it directly", "Wait and process first"] },
  { key: "p7", label: "Which feels more satisfying?", type: "single", options: ["Finishing something cleanly", "Keeping options open longer"] },
  { key: "p8", label: "You often notice first:", type: "single", options: ["Mood and atmosphere", "Systems and structure"] },
  { key: "p9", label: "What drives you more?", type: "single", options: ["Curiosity", "Security"] },
  { key: "p10", label: "When resting, you prefer:", type: "single", options: ["Going out and getting stimulation", "Being alone and resetting internally"] },
  { key: "p11", label: "Your creative instinct is more:", type: "single", options: ["Minimal and precise", "Expressive and layered"] },
  { key: "p12", label: "When a plan fails, you usually:", type: "single", options: ["Rebuild quickly", "Reflect on why it felt wrong"] },
  { key: "p13", label: "People might describe you as:", type: "single", options: ["Consistent", "Contradictory in an interesting way"] },
  { key: "p14", label: "Which sounds more like you?", type: "single", options: ["I like clarity", "I like ambiguity"] },
  { key: "p15", label: "When something matters deeply, you tend to:", type: "single", options: ["Protect it quietly", "Express it openly"] }
];

const interestQuestion = {
  key: "interests",
  label: "Which fields or topics do you want the system to recommend back to you?",
  type: "multi",
  minSelect: 3,
  options: [
    "Art and exhibitions",
    "Creative coding",
    "AI and emerging tech",
    "Games and interactive media",
    "Fashion and styling",
    "Music and sound design",
    "Film and moving image",
    "Design research",
    "Psychology and selfhood",
    "Philosophy and critical theory",
    "Health and wellbeing",
    "Travel and cities",
    "Books and publishing",
    "Food culture",
    "Architecture and space"
  ]
};

const questions = [
  ...basicQuestions.map((q) => ({ ...q, stage: "Basic information" })),
  ...personalityQuestions.map((q) => ({ ...q, stage: "Personality test" })),
  { ...interestQuestion, stage: "Interest selection" }
];

const answers = {};
let currentQuestionIndex = 0;
let isGenerating = false;
let portraitReady = false;
let ui = {};

// ===== visual =====
let faceBox = null;

// proximity
let rawProximity = 0;
let fastProximity = 0;
let smoothedProximity = 0;
let stableProximity = 0;
let presenceConfidence = 0;
let proximityDeadband = 0.006;

// 重新分配分段：
// 蓝 -> 紫 更长；紫 -> 红更短
let nearThreshold = 0.268;
let splitThreshold = 0.318;
let collapseThreshold = 0.362;

let portraitWords = [];
let primaryWords = [];
let secondaryWords = [];
let phrasePool = [];

let featurePoints = {
  leftEye: null,
  rightEye: null,
  nose: null,
  mouth: null,
  leftBrow: null,
  rightBrow: null,
  chin: null,
  forehead: null
};

let fallingLetters = [];
const asciiChars = " .,:;i1tfLCG08@";
const baseBg = [248, 248, 246];

let portraitRegion = {
  x: 0,
  y: 0,
  w: 0,
  h: 0
};

let sampleCols = 120;
let sampleRows = 90;

// boundary / ending
let collapseState = 0;
let warningAlpha = 0;
let stage3HoldFrames = 0;
let interactionEnded = false;
let endingProgress = 0;

// =====================================================
// SETUP
// =====================================================
function setup() {
  const canvas = createCanvas(960, 720);
  canvas.parent("canvas-holder");

  pixelDensity(1);
  textFont("monospace");
  textAlign(CENTER, CENTER);
  rectMode(CENTER);
  smooth();

  updatePortraitRegion();

  video = createCapture(
    { video: { facingMode: "user" }, audio: false },
    () => {
      video.size(640, 480);
      video.hide();
      updateCameraStatus("Camera ready");
      setTimeout(() => initFaceTracking(), 700);
    }
  );

  cacheUI();
  bindUI();
  renderQuestion();
}

function windowResized() {
  resizeCanvas(960, 720);
  updatePortraitRegion();
}

function updatePortraitRegion() {
  portraitRegion.w = width * 0.84;
  portraitRegion.h = height * 0.84;
  portraitRegion.x = width * 0.5;
  portraitRegion.y = height * 0.50;
}

// =====================================================
// FACEMESH
// =====================================================
function initFaceTracking() {
  if (faceTrackingStarted || faceInitAttempted) return;
  faceInitAttempted = true;

  if (typeof ml5 === "undefined") {
    updateCameraStatus("ml5 not loaded");
    return;
  }

  try {
    faceMesh = ml5.faceMesh(
      { maxFaces: 1, refineLandmarks: true },
      () => {
        faceTrackingReady = true;
        faceTrackingStarted = true;
        updateCameraStatus("Face tracking ready");

        try {
          if (faceMesh && typeof faceMesh.detectStart === "function") {
            faceMesh.detectStart(video, gotFaces);
          } else {
            faceTrackingReady = false;
            updateCameraStatus("Face tracking unavailable");
          }
        } catch (err) {
          console.error(err);
          faceTrackingReady = false;
          updateCameraStatus("Face tracking failed");
        }
      }
    );
  } catch (err) {
    console.error(err);
    faceTrackingReady = false;
    updateCameraStatus("Face tracking failed");
  }
}

function gotFaces(results) {
  facePredictions = Array.isArray(results) ? results : [];
}

// =====================================================
// DRAW
// =====================================================
function draw() {
  background(...baseBg);

  if (!portraitReady) {
    drawWaitingCanvas();
    return;
  }

  drawBackgroundState();

  if (video && video.elt && video.elt.readyState >= 2) {
    video.loadPixels();
    updateTrackedFace();

    if (!interactionEnded) {
      updateBoundaryState();
      drawAsciiWordPortrait();
      updateAndDrawFallingLetters();

      if (collapseState === 3 && presenceConfidence > 0.55) {
        drawBoundaryWarning(map(stableProximity, collapseThreshold, 0.44, 0, 1, true));
      }
    } else {
      updateEndingAnimation();
      drawEndedOverlay();
    }

    drawPortraitInfo();
  } else {
    drawWaitingCanvas();
  }
}

function drawWaitingCanvas() {
  noStroke();
  fill(255, 228);
  rect(width / 2, height / 2, width * 0.9, height * 0.84, 28);

  push();
  textFont("Helvetica");
  fill(30);
  textSize(28);
  text("Portrait will appear after the questionnaire", width / 2, height / 2 - 20);

  fill(80);
  textSize(15);
  text("Finish all questions first, then the live camera portrait will be activated.", width / 2, height / 2 + 18);
  pop();
}

function drawBackgroundState() {
  let r = baseBg[0];
  let g = baseBg[1];
  let b = baseBg[2];

  if (!interactionEnded) {
    if (collapseState === 1) {
      r = lerp(r, 244, 0.08);
      g = lerp(g, 240, 0.06);
      b = lerp(b, 250, 0.14);
    } else if (collapseState === 2) {
      r = lerp(r, 247, 0.11);
      g = lerp(g, 238, 0.08);
      b = lerp(b, 246, 0.10);
    } else if (collapseState === 3) {
      r = lerp(r, 251, 0.18);
      g = lerp(g, 233, 0.12);
      b = lerp(b, 233, 0.12);
    }
  } else {
    r = lerp(r, 252, 0.65);
    g = lerp(g, 246, 0.65);
    b = lerp(b, 246, 0.65);
  }

  background(r, g, b);
}

// =====================================================
// FACE TRACKING DATA
// =====================================================
function updateTrackedFace() {
  if (!facePredictions.length) {
    trackedFace = null;
    faceBox = null;
    rawProximity = 0;
    fastProximity = lerp(fastProximity, 0, 0.10);
    smoothedProximity = lerp(smoothedProximity, 0, 0.08);
    stableProximity = lerp(stableProximity, 0, 0.08);
    presenceConfidence = max(0, presenceConfidence - 0.08);
    resetFeaturePoints();
    return;
  }

  const face = facePredictions[0];
  const points = face.keypoints || face.landmarks || face.scaledMesh || [];

  if (!points.length) {
    trackedFace = null;
    faceBox = null;
    rawProximity = 0;
    fastProximity = lerp(fastProximity, 0, 0.10);
    smoothedProximity = lerp(smoothedProximity, 0, 0.08);
    stableProximity = lerp(stableProximity, 0, 0.08);
    presenceConfidence = max(0, presenceConfidence - 0.08);
    resetFeaturePoints();
    return;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const p of points) {
    const px = p.x ?? p[0];
    const py = p.y ?? p[1];
    minX = min(minX, px);
    minY = min(minY, py);
    maxX = max(maxX, px);
    maxY = max(maxY, py);
  }

  const fw = maxX - minX;
  const fh = maxY - minY;
  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;

  if (!isFinite(cx) || !isFinite(cy) || fw <= 0 || fh <= 0) {
    trackedFace = null;
    faceBox = null;
    rawProximity = 0;
    fastProximity = lerp(fastProximity, 0, 0.10);
    smoothedProximity = lerp(smoothedProximity, 0, 0.08);
    stableProximity = lerp(stableProximity, 0, 0.08);
    presenceConfidence = max(0, presenceConfidence - 0.08);
    resetFeaturePoints();
    return;
  }

  const nextFace = {
    cx,
    cy,
    fw,
    fh,
    leftEye: averagePoints(points, [33, 133, 159, 145]),
    rightEye: averagePoints(points, [362, 263, 386, 374]),
    noseTip: averagePoints(points, [1, 2, 4, 5, 94, 168]),
    mouthCenter: averagePoints(points, [13, 14, 17, 0, 61, 291]),
    leftBrow: averagePoints(points, [70, 63, 105, 66]),
    rightBrow: averagePoints(points, [336, 296, 334, 293]),
    chin: averagePoints(points, [152, 176, 148]),
    forehead: averagePoints(points, [10, 151, 9])
  };

  if (!trackedFace) {
    trackedFace = nextFace;
  } else {
    trackedFace.cx = lerp(trackedFace.cx, nextFace.cx, 0.16);
    trackedFace.cy = lerp(trackedFace.cy, nextFace.cy, 0.16);
    trackedFace.fw = lerp(trackedFace.fw, nextFace.fw, 0.16);
    trackedFace.fh = lerp(trackedFace.fh, nextFace.fh, 0.16);
    trackedFace.leftEye = lerpPoint(trackedFace.leftEye, nextFace.leftEye, 0.18);
    trackedFace.rightEye = lerpPoint(trackedFace.rightEye, nextFace.rightEye, 0.18);
    trackedFace.noseTip = lerpPoint(trackedFace.noseTip, nextFace.noseTip, 0.18);
    trackedFace.mouthCenter = lerpPoint(trackedFace.mouthCenter, nextFace.mouthCenter, 0.18);
    trackedFace.leftBrow = lerpPoint(trackedFace.leftBrow, nextFace.leftBrow, 0.18);
    trackedFace.rightBrow = lerpPoint(trackedFace.rightBrow, nextFace.rightBrow, 0.18);
    trackedFace.chin = lerpPoint(trackedFace.chin, nextFace.chin, 0.18);
    trackedFace.forehead = lerpPoint(trackedFace.forehead, nextFace.forehead, 0.18);
  }

  const padX = trackedFace.fw * 0.16;
  const padY = trackedFace.fh * 0.20;

  faceBox = {
    x: constrain(trackedFace.cx - trackedFace.fw * 0.5 - padX, 0, video.width - 1),
    y: constrain(trackedFace.cy - trackedFace.fh * 0.54 - padY, 0, video.height - 1),
    w: constrain(trackedFace.fw + padX * 2, 1, video.width),
    h: constrain(trackedFace.fh + padY * 2, 1, video.height)
  };

  const widthRatio = trackedFace.fw / video.width;
  const heightRatio = trackedFace.fh / video.height;
  const eyeDist = distPoint(trackedFace.leftEye, trackedFace.rightEye);
  const eyeRatio = eyeDist / video.width;
  const areaRatio = (trackedFace.fw * trackedFace.fh) / (video.width * video.height);
  const centerW = centerWeight(trackedFace.cx, trackedFace.cy);

  // 使用多指标混合，并略微压缩极端值
  let mixed =
    widthRatio * 0.43 +
    heightRatio * 0.17 +
    eyeRatio * 0.28 +
    sqrt(max(areaRatio, 0)) * 0.12;

  mixed *= centerW;

  // 映射到更适合当前阈值的区间
  rawProximity = constrain(map(mixed, 0.12, 0.43, 0, 0.52, true), 0, 0.52);

  const plausibleFace = areaRatio > 0.025 && eyeRatio > 0.045;

  if (plausibleFace) {
    presenceConfidence = min(1, presenceConfidence + 0.055);
  } else {
    presenceConfidence = max(0, presenceConfidence - 0.10);
  }

  fastProximity = lerp(fastProximity, rawProximity, 0.14);

  if (fastProximity > smoothedProximity) {
    smoothedProximity = lerp(smoothedProximity, fastProximity, 0.10);
  } else {
    smoothedProximity = lerp(smoothedProximity, fastProximity, 0.05);
  }

  // 死区，减少阈值边缘的抖动
  if (abs(smoothedProximity - stableProximity) > proximityDeadband) {
    stableProximity = lerp(stableProximity, smoothedProximity, 0.18);
  } else {
    stableProximity = lerp(stableProximity, smoothedProximity, 0.05);
  }

  if (presenceConfidence < 0.45) {
    stableProximity *= 0.84;
  }

  featurePoints.leftEye = trackedFace.leftEye;
  featurePoints.rightEye = trackedFace.rightEye;
  featurePoints.nose = trackedFace.noseTip;
  featurePoints.mouth = trackedFace.mouthCenter;
  featurePoints.leftBrow = trackedFace.leftBrow;
  featurePoints.rightBrow = trackedFace.rightBrow;
  featurePoints.chin = trackedFace.chin;
  featurePoints.forehead = trackedFace.forehead;
}

function resetFeaturePoints() {
  featurePoints = {
    leftEye: null,
    rightEye: null,
    nose: null,
    mouth: null,
    leftBrow: null,
    rightBrow: null,
    chin: null,
    forehead: null
  };
}

// =====================================================
// BOUNDARY / ENDING STATE
// =====================================================
function getBoundaryStage() {
  if (interactionEnded) return 3;
  if (presenceConfidence < 0.45) return 0;

  if (collapseState === 0) {
    if (stableProximity >= nearThreshold) return 1;
    return 0;
  }

  if (collapseState === 1) {
    if (stableProximity >= splitThreshold) return 2;
    if (stableProximity < nearThreshold - 0.020) return 0;
    return 1;
  }

  if (collapseState === 2) {
    if (stableProximity >= collapseThreshold) return 3;
    if (stableProximity < splitThreshold - 0.018) return 1;
    return 2;
  }

  if (collapseState === 3) {
    if (stableProximity < collapseThreshold - 0.030) return 2;
    return 3;
  }

  return 0;
}

function updateBoundaryState() {
  collapseState = getBoundaryStage();

  if (collapseState === 3 && presenceConfidence > 0.55) {
    stage3HoldFrames++;
  } else {
    stage3HoldFrames = max(0, stage3HoldFrames - 3);
  }

  warningAlpha = collapseState === 3
    ? min(255, warningAlpha + 12)
    : max(0, warningAlpha - 12);

  // 进入红色后不恢复，而是结束交互
  if (stage3HoldFrames > 12) {
    interactionEnded = true;
    endingProgress = 0;
    updateCameraStatus("Boundary crossed");
  }
}

function updateEndingAnimation() {
  endingProgress = min(1, endingProgress + 0.035);

  if (frameCount % 2 === 0 && portraitWords.length) {
    for (let i = 0; i < 10; i++) {
      const token = random(phrasePool.length ? phrasePool : portraitWords);
      if (!token) continue;

      fallingLetters.push({
        ch: random(String(token).split("")),
        x: random(width * 0.18, width * 0.82),
        y: random(height * 0.20, height * 0.80),
        vx: random(-2.2, 2.2),
        vy: random(0.8, 2.8),
        gravity: random(0.08, 0.22),
        alpha: random(120, 220),
        size: random(11, 18),
        r: 235,
        g: 52,
        b: 62
      });
    }
  }

  updateAndDrawFallingLetters();
}

function drawEndedOverlay() {
  push();
  noStroke();

  const bgA = map(endingProgress, 0, 1, 0, 238, true);
  fill(248, 246, 246, bgA);
  rect(width * 0.5, height * 0.5, width, height);

  fill(232, 40, 50, map(endingProgress, 0, 1, 0, 255, true));
  textAlign(CENTER, CENTER);

  textSize(30);
  text("BOUNDARY CROSSED", width * 0.5, height * 0.46);

  textSize(14);
  text("INTERACTION TERMINATED", width * 0.5, height * 0.53);

  textSize(12);
  fill(210, 60, 68, map(endingProgress, 0, 1, 0, 180, true));
  text("Press Reset to begin again", width * 0.5, height * 0.59);
  pop();
}

function drawBoundaryWarning(t) {
  push();
  noFill();
  stroke(235, 58, 62, 90 + t * 130);
  strokeWeight(1.4 + t * 2.4);
  rect(width * 0.5, height * 0.5, width * 0.92, height * 0.88, 28);

  noStroke();
  fill(235, 58, 62, 120 + t * 110);
  textSize(13 + t * 5);
  textAlign(CENTER, TOP);
  text("BOUNDARY CROSSED", width * 0.5, 26);
  pop();
}

// =====================================================
// ASCII FACE VISUAL
// =====================================================
function drawAsciiWordPortrait() {
  if (!faceTrackingReady) {
    fill(40, 110);
    textSize(18);
    text("Starting face tracking...", width / 2, height / 2);
    return;
  }

  if (!trackedFace || !faceBox) {
    fill(40, 110);
    textSize(18);
    text("Move your face into view", width / 2, height / 2);
    return;
  }

  const stage = collapseState;
  const tNear = map(stableProximity, nearThreshold, splitThreshold, 0, 1, true);
  const tSplit = map(stableProximity, splitThreshold, collapseThreshold, 0, 1, true);
  const tCollapse = map(stableProximity, collapseThreshold, 0.44, 0, 1, true);

  const left = portraitRegion.x - portraitRegion.w * 0.5;
  const top = portraitRegion.y - portraitRegion.h * 0.5;
  const cellW = portraitRegion.w / sampleCols;
  const cellH = portraitRegion.h / sampleRows;

  textAlign(LEFT, TOP);
  noStroke();

  fill(80, 70, 170, 28);
  textSize(12);
  text("Portrait by Inference", 18, 18);

  const freezeStep = stage === 1 ? 2 : stage === 2 ? 4 : stage === 3 ? 6 : 1;
  const snapAmount = stage === 1 ? 1.5 : stage === 2 ? 3.4 : stage === 3 ? 5.4 : 0;

  for (let y = 0; y < sampleRows; y++) {
    for (let x = 0; x < sampleCols; x++) {
      if (freezeStep > 1) {
        const holdX = floor(x / freezeStep);
        const holdY = floor(y / freezeStep);
        const phase = floor(frameCount / (stage === 1 ? 6 : stage === 2 ? 8 : 10));

        if ((holdX + holdY + phase) % freezeStep !== 0 && random() < (stage === 1 ? 0.34 : stage === 2 ? 0.54 : 0.70)) {
          continue;
        }
      }

      const sx = left + x * cellW;
      const sy = top + y * cellH;

      const sample = sampleFaceCrop(x, y);
      const bright = sampleVideoBrightness(sample.x, sample.y);
      const darkness = map(bright, 255, 0, 0, 1, true);

      const charIndex = floor(map(bright, 255, 0, 0, asciiChars.length - 1));
      const asciiChar = asciiChars.charAt(constrain(charIndex, 0, asciiChars.length - 1));

      let txt = asciiChar;
      let alphaVal = map(darkness, 0, 1, 15, 118, true);
      let fontSize = map(darkness, 0, 1, 7, 14, true);
      let useWord = false;

      if (darkness > 0.43 && random() < 0.16) {
        txt = pickWordToken(false);
        alphaVal = map(darkness, 0.43, 1.0, 68, 206, true);
        fontSize = map(darkness, 0.43, 1.0, 8, 16, true);
        useWord = true;
      }

      if (darkness > 0.69 && random() < 0.38) {
        txt = pickWordToken(true);
        alphaVal = map(darkness, 0.69, 1.0, 125, 250, true);
        fontSize = map(darkness, 0.69, 1.0, 10, 20, true);
        useWord = true;
      }

      if (!txt) continue;

      if (txt.length > 12) fontSize *= 0.72;
      else if (txt.length > 8) fontSize *= 0.84;

      let rr = 65;
      let gg = 58;
      let bb = 165;

      if (stage === 1) {
        rr = lerp(84, 154, tNear);
        gg = lerp(76, 86, tNear);
        bb = lerp(208, 236, tNear);
      } else if (stage === 2) {
        rr = lerp(146, 196, tSplit);
        gg = lerp(88, 68, tSplit);
        bb = lerp(226, 190, tSplit);
      } else if (stage === 3) {
        rr = lerp(224, 248, tCollapse);
        gg = lerp(58, 34, tCollapse);
        bb = lerp(72, 42, tCollapse);
      } else {
        if (darkness > 0.52) {
          rr = 58;
          gg = 50;
          bb = 182;
        }
        if (darkness > 0.84) {
          rr = 46;
          gg = 38;
          bb = 188;
        }
      }

      let jx = 0;
      let jy = 0;

      if (stage === 1) {
        jx += random(-0.8, 0.8) * (0.7 + tNear * 1.1);
        jy += random(-0.7, 0.7) * (0.7 + tNear * 1.0);
      } else if (stage === 2) {
        jx += random(-1.8, 1.8) * (1.1 + tSplit * 1.4);
        jy += random(-1.2, 1.2) * (1.1 + tSplit * 1.2);
      } else if (stage === 3) {
        jx += random(-4.0, 4.0) * (1.0 + tCollapse * 1.6);
        jy += random(-2.8, 2.8) * (1.0 + tCollapse * 1.4);
      }

      let dx = sx + jx;
      let dy = sy + jy;

      if (snapAmount > 0) {
        dx = round(dx / snapAmount) * snapAmount;
        dy = round(dy / snapAmount) * snapAmount;
      }

      if (stage === 3 && useWord && txt.length > 2) {
        drawSplitPhrase(txt, dx, dy, fontSize, alphaVal, rr, gg, bb, 0.52 + tCollapse * 0.42, tCollapse, darkness);
      } else if (stage === 2 && useWord && txt.length > 2 && random() < 0.12) {
        drawSplitPhrase(txt, dx, dy, fontSize, alphaVal, rr, gg, bb, 0.16 + tSplit * 0.18, 0, darkness);
      } else {
        fill(rr, gg, bb, alphaVal);
        textSize(fontSize);
        text(txt, dx, dy);
      }

      if (stage === 3 && useWord && txt.length > 2 && darkness > 0.72) {
        if (random() < 0.016 + tCollapse * 0.08) {
          spawnFallingLetters(txt, dx, dy, rr, gg, bb, fontSize, tCollapse);
        }
      }
    }
  }
}

function sampleFaceCrop(gx, gy) {
  if (!faceBox) {
    return { x: video.width * 0.5, y: video.height * 0.5 };
  }

  const u = gx / max(sampleCols - 1, 1);
  const v = gy / max(sampleRows - 1, 1);

  const x = faceBox.x + u * faceBox.w;
  const y = faceBox.y + v * faceBox.h;

  return {
    x: constrain(x, 0, video.width - 1),
    y: constrain(y, 0, video.height - 1)
  };
}

function pickWordToken(strong = false) {
  if (strong) {
    return random(primaryWords.length ? primaryWords : portraitWords);
  }
  if (random() < 0.55) {
    return random(primaryWords.length ? primaryWords : portraitWords);
  }
  return random(phrasePool.length ? phrasePool : portraitWords);
}

// =====================================================
// SPLIT / COLLAPSE
// =====================================================
function drawSplitPhrase(phrase, x, y, fontSize, alphaVal, rr, gg, bb, splitAmount, collapseAmount, weight) {
  const chars = String(phrase).split("");
  if (!chars.length) return;

  const spacing = fontSize * (0.28 + splitAmount * 0.30 + collapseAmount * 0.74);
  const totalWidth = (chars.length - 1) * spacing;
  const startX = x - totalWidth * 0.5;

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const driftX = splitAmount * random(-2.2, 2.2) + collapseAmount * random(-16, 16);
    const driftY = splitAmount * random(-1.2, 1.2) + collapseAmount * random(-10, 10);

    const px = startX + i * spacing + driftX;
    const py = y + driftY;

    fill(rr, gg, bb, alphaVal);
    textSize(fontSize);
    text(ch, px, py);

    if (collapseState === 3 && weight > 0.62 && ch !== " ") {
      if (random() < 0.010 + collapseAmount * 0.06) {
        fallingLetters.push({
          ch,
          x: px,
          y: py,
          vx: random(-1.6, 1.6) + collapseAmount * random(-2.8, 2.8),
          vy: random(1.0, 2.8),
          gravity: random(0.08, 0.22),
          alpha: random(120, 220),
          size: fontSize,
          r: rr,
          g: gg,
          b: bb
        });
      }
    }
  }
}

function spawnFallingLetters(phrase, x, y, rr, gg, bb, fontSize, collapseAmount) {
  const chars = String(phrase).split("");
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] === " ") continue;
    if (random() < 0.68) continue;

    fallingLetters.push({
      ch: chars[i],
      x: x + random(-8, 8),
      y: y + random(-5, 5),
      vx: random(-1.6, 1.6) + collapseAmount * random(-3.0, 3.0),
      vy: random(1.2, 3.0),
      gravity: random(0.08, 0.24),
      alpha: random(120, 230),
      size: fontSize,
      r: lerp(rr, 245, 0.42),
      g: lerp(gg, 52, 0.42),
      b: lerp(bb, 58, 0.32)
    });
  }
}

function updateAndDrawFallingLetters() {
  textAlign(CENTER, CENTER);

  for (let i = fallingLetters.length - 1; i >= 0; i--) {
    const f = fallingLetters[i];
    f.x += f.vx;
    f.y += f.vy;
    f.vy += f.gravity;
    f.alpha -= interactionEnded ? 2.6 : 1.6;

    fill(f.r, f.g, f.b, f.alpha);
    noStroke();
    textSize(f.size);
    text(f.ch, f.x, f.y);

    if (f.alpha <= 0 || f.y > height + 40) {
      fallingLetters.splice(i, 1);
    }
  }
}

// =====================================================
// INFO
// =====================================================
function drawPortraitInfo() {
  noStroke();

  fill(90, 90, 100, 95);
  textAlign(LEFT, TOP);
  textSize(11);
  text(personaTitle || "portrait by inference", 22, 22);

  const stage = interactionEnded ? 3 : collapseState;
  let rr = 150;
  let gg = 148;
  let bb = 154;

  if (stage === 1) {
    rr = 156;
    gg = 98;
    bb = 224;
  } else if (stage === 2) {
    rr = 188;
    gg = 84;
    bb = 214;
  } else if (stage === 3) {
    rr = 240;
    gg = 46;
    bb = 52;
  }

  fill(rr, gg, bb, 120);
  textAlign(LEFT, BOTTOM);
  textSize(11);
  text(
    `proximity ${nf(stableProximity, 1, 3)}  |  confidence ${nf(presenceConfidence, 1, 2)}  |  stage ${interactionEnded ? "END" : collapseState}`,
    22,
    height - 18
  );

  textAlign(CENTER, CENTER);
}

// =====================================================
// VIDEO HELPERS
// =====================================================
function sampleVideoBrightness(vx, vy) {
  if (!video || !video.pixels || video.pixels.length === 0) return 140;

  const x = constrain(floor(vx), 0, video.width - 1);
  const y = constrain(floor(vy), 0, video.height - 1);
  const idx = (x + y * video.width) * 4;

  const r = video.pixels[idx] || 0;
  const g = video.pixels[idx + 1] || 0;
  const b = video.pixels[idx + 2] || 0;

  return (r + g + b) / 3;
}

function averagePoints(points, indices) {
  let sx = 0;
  let sy = 0;
  let count = 0;

  for (const idx of indices) {
    const p = points[idx];
    if (!p) continue;
    sx += p.x ?? p[0];
    sy += p.y ?? p[1];
    count++;
  }

  if (!count) return null;
  return { x: sx / count, y: sy / count };
}

function lerpPoint(a, b, amt = 0.2) {
  if (!a) return b;
  if (!b) return a;
  return {
    x: lerp(a.x, b.x, amt),
    y: lerp(a.y, b.y, amt)
  };
}

function distPoint(a, b) {
  if (!a || !b) return 0;
  return dist(a.x, a.y, b.x, b.y);
}

function centerWeight(cx, cy) {
  const nx = cx / video.width;
  const ny = cy / video.height;

  const dx = abs(nx - 0.5) / 0.5;
  const dy = abs(ny - 0.5) / 0.5;
  const d = sqrt(dx * dx + dy * dy);

  return constrain(map(d, 0, 1.15, 1.0, 0.74), 0.74, 1.0);
}

// =====================================================
// WORD LEXICON
// =====================================================
function refreshPortraitLexicon() {
  const words = (personaWords || []).map(normalizePhrase).filter(Boolean);
  const phraseWords = (personaPhrases || [])
    .map(normalizePhrase)
    .filter(Boolean)
    .flatMap((p) => p.split(/\s+/))
    .filter((w) => w.length > 1);

  portraitWords = uniqueWords([
    ...words,
    ...words,
    ...phraseWords,
    ...phraseWords
  ]);

  if (portraitWords.length < 6) {
    portraitWords = [
      "inferred",
      "estimated",
      "observed",
      "guarded",
      "quiet",
      "distant",
      "reflective",
      "curious"
    ];
  }

  primaryWords = portraitWords.slice(0, min(8, portraitWords.length));
  secondaryWords = portraitWords.slice(0);
  phrasePool = buildPhrasePool(primaryWords, secondaryWords);
}

function buildPhrasePool(primary, secondary) {
  const pool = [];

  primary.forEach((w) => {
    pool.push(w);
    pool.push(w);
    pool.push(w);
  });

  secondary.forEach((w) => pool.push(w));

  for (let i = 0; i < min(secondary.length, 12); i++) {
    const a = random(primary.length ? primary : secondary);
    const b = random(secondary);
    if (a && b && a !== b) pool.push(`${a} ${b}`);
  }

  (personaPhrases || []).forEach((p) => {
    const clean = normalizePhrase(p);
    if (!clean) return;
    pool.push(clean);
    clean.split(/\s+/).forEach((bit) => pool.push(bit));
  });

  return uniqueWords(pool);
}

function uniqueWords(arr) {
  return [...new Set(arr.filter(Boolean).map((w) => String(w).trim().toLowerCase()))];
}

function normalizePhrase(word) {
  return String(word || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?]+$/g, "");
}

// =====================================================
// UI
// =====================================================
function cacheUI() {
  ui.startButton = select("#start-button");
  ui.resetButton = select("#reset-button");
  ui.backButton = select("#back-button");
  ui.nextButton = select("#next-button");
  ui.regenerateButton = select("#regenerate-button");

  ui.introCard = select("#intro-card");
  ui.questionnaireCard = select("#questionnaire-card");
  ui.loadingCard = select("#loading-card");
  ui.resultCard = select("#result-card");
  ui.questionBlock = select("#question-block");
  ui.stageLabel = select("#stage-label");
  ui.progressLabel = select("#progress-label");
  ui.progressFill = select("#progress-fill");
  ui.resultTitle = select("#result-title");
  ui.resultSummary = select("#result-summary");
  ui.keywordsContainer = select("#keywords-container");
  ui.phrasesContainer = select("#phrases-container");
  ui.resultRecommendations = select("#result-recommendations");
  ui.visualPanel = select("#visual-panel");
}

function bindUI() {
  ui.startButton.mousePressed(startQuestionnaire);
  ui.resetButton.mousePressed(resetExperience);
  ui.backButton.mousePressed(goBack);
  ui.nextButton.mousePressed(goNext);
  ui.regenerateButton.mousePressed(() => generatePortrait());
}

function startQuestionnaire() {
  ui.introCard.addClass("hidden");
  ui.questionnaireCard.removeClass("hidden");
  renderQuestion();
}

function resetExperience() {
  for (const key of Object.keys(answers)) delete answers[key];

  currentQuestionIndex = 0;
  isGenerating = false;
  portraitReady = false;

  trackedFace = null;
  facePredictions = [];
  faceTrackingReady = false;
  faceTrackingStarted = false;
  faceInitAttempted = false;
  faceMesh = null;

  faceBox = null;
  rawProximity = 0;
  fastProximity = 0;
  smoothedProximity = 0;
  stableProximity = 0;
  presenceConfidence = 0;
  fallingLetters = [];
  collapseState = 0;
  warningAlpha = 0;
  stage3HoldFrames = 0;
  interactionEnded = false;
  endingProgress = 0;
  resetFeaturePoints();

  personaWords = ["latent", "curious", "shifting", "signal", "mirror", "social", "memory"];
  personaPhrases = ["becoming through interaction", "pattern seeking under pressure"];
  personaTitle = "Unresolved Persona";
  personaSummary = "Complete the questionnaire to generate a live portrait.";
  personaRecommendations = [];

  portraitWords = [];
  primaryWords = [];
  secondaryWords = [];
  phrasePool = [];

  ui.resultCard.addClass("hidden");
  ui.loadingCard.addClass("hidden");
  ui.questionnaireCard.addClass("hidden");
  ui.introCard.removeClass("hidden");
  ui.visualPanel.addClass("hidden");

  updateCameraStatus("Camera idle");
  setTimeout(() => initFaceTracking(), 500);
}

function goBack() {
  if (currentQuestionIndex > 0) {
    currentQuestionIndex -= 1;
    renderQuestion();
  }
}

function goNext() {
  const question = questions[currentQuestionIndex];
  const value = readCurrentQuestionValue(question);

  if (!validateAnswer(question, value)) return;

  answers[question.key] = value;

  if (currentQuestionIndex < questions.length - 1) {
    currentQuestionIndex += 1;
    renderQuestion();
  } else {
    generatePortrait();
  }
}

function renderQuestion() {
  const question = questions[currentQuestionIndex];
  const stageIndex = currentQuestionIndex < 10 ? 1 : currentQuestionIndex < 25 ? 2 : 3;

  ui.stageLabel.html(`${question.stage} · Stage ${stageIndex}`);
  ui.progressLabel.html(`${currentQuestionIndex + 1} / ${questions.length}`);
  ui.progressFill.style("width", `${((currentQuestionIndex + 1) / questions.length) * 100}%`);
  ui.backButton.elt.disabled = currentQuestionIndex === 0;
  ui.nextButton.html(currentQuestionIndex === questions.length - 1 ? "Generate portrait" : "Next");

  let html = `
    <div class="question-type">${question.type === "text" ? "Fill in" : question.type === "single" ? "Single choice" : "Multiple choice"}</div>
    <div class="question-title">${question.label}</div>
  `;

  if (question.type === "text") {
    html += `<div class="question-help">Answer briefly. This information will be used as grounding context for the portrait.</div>`;
    html += `<input id="question-input" class="text-input" type="text" placeholder="${question.placeholder || "Type here"}" value="${escapeHtml(answers[question.key] || "")}">`;
  }

  if (question.type === "single") {
    html += `<div class="question-help">Choose the option that feels closer to you right now.</div>`;
    html += `<div class="option-group">`;
    question.options.forEach((option) => {
      const checked = answers[question.key] === option ? "checked" : "";
      html += `
        <label class="option-card">
          <input type="radio" name="question-option" value="${escapeAttribute(option)}" ${checked}>
          <span>${option}</span>
        </label>
      `;
    });
    html += `</div>`;
  }

  if (question.type === "multi") {
    html += `<div class="question-help">Choose at least ${question.minSelect || 1} areas. These will shape future recommendation directions.</div>`;
    html += `<div class="checkbox-group">`;
    const selected = Array.isArray(answers[question.key]) ? answers[question.key] : [];
    question.options.forEach((option) => {
      const checked = selected.includes(option) ? "checked" : "";
      html += `
        <label class="checkbox-card">
          <input type="checkbox" value="${escapeAttribute(option)}" ${checked}>
          <span>${option}</span>
        </label>
      `;
    });
    html += `</div>`;
  }

  ui.questionBlock.html(html);
}

function readCurrentQuestionValue(question) {
  if (question.type === "text") {
    const input = document.getElementById("question-input");
    return input ? input.value.trim() : "";
  }

  if (question.type === "single") {
    const checked = document.querySelector('input[name="question-option"]:checked');
    return checked ? checked.value : "";
  }

  if (question.type === "multi") {
    const checked = Array.from(document.querySelectorAll('.checkbox-group input[type="checkbox"]:checked'));
    return checked.map((item) => item.value);
  }

  return "";
}

function validateAnswer(question, value) {
  if (question.type === "text" && !value) {
    alert("Please fill in this answer first.");
    return false;
  }

  if (question.type === "single" && !value) {
    alert("Please choose one option.");
    return false;
  }

  if (question.type === "multi" && (!Array.isArray(value) || value.length < (question.minSelect || 1))) {
    alert(`Please choose at least ${question.minSelect || 1} options.`);
    return false;
  }

  return true;
}

// =====================================================
// SOCKET
// =====================================================
function generatePortrait() {
  if (!connected || isGenerating) return;

  isGenerating = true;
  ui.questionnaireCard.addClass("hidden");
  ui.resultCard.addClass("hidden");
  ui.loadingCard.removeClass("hidden");
  updateCameraStatus("Generating portrait");

  socket.emit("generate-portrait", { answers });
}

socket.on("connect", () => {
  connected = true;
  console.log("connected to server");
});

socket.on("disconnect", () => {
  connected = false;
  console.log("disconnected from server");
});

socket.on("portrait-result", (payload) => {
  isGenerating = false;
  portraitReady = true;

  applyPortrait(payload);
  refreshPortraitLexicon();

  ui.loadingCard.addClass("hidden");
  ui.resultCard.removeClass("hidden");
  ui.visualPanel.removeClass("hidden");

  updateCameraStatus(faceTrackingReady ? "Camera live" : "Starting face tracking...");
});

socket.on("portrait-error", (payload) => {
  isGenerating = false;
  ui.loadingCard.addClass("hidden");
  ui.questionnaireCard.removeClass("hidden");
  updateCameraStatus("Generation failed");
  alert(payload?.message || "Something went wrong while generating the portrait.");
});

// =====================================================
// APPLY RESULT
// =====================================================
function applyPortrait(payload) {
  personaTitle = payload.archetype || payload.profileTitle || "Generated Persona";
  personaSummary = payload.summary || "A live portrait has been generated.";
  personaWords = Array.isArray(payload.words)
    ? payload.words
    : Array.isArray(payload.keywords)
      ? payload.keywords
      : personaWords;
  personaPhrases = Array.isArray(payload.phrases) ? payload.phrases : personaPhrases;
  personaRecommendations = Array.isArray(payload.recommendations) ? payload.recommendations : [];

  ui.resultTitle.html(escapeHtml(personaTitle));
  ui.resultSummary.html(escapeHtml(personaSummary));

  ui.keywordsContainer.html("");
  personaWords.forEach((word) => {
    const pill = createSpan(word);
    pill.parent(ui.keywordsContainer);
    pill.addClass("pill");
  });

  ui.phrasesContainer.html("");
  personaPhrases.forEach((phrase) => {
    const div = createDiv(escapeHtml(phrase));
    div.parent(ui.phrasesContainer);
    div.addClass("phrase-item");
  });

  ui.resultRecommendations.html("");
  personaRecommendations.forEach((item) => {
    const li = createElement("li", escapeHtml(item));
    li.parent(ui.resultRecommendations);
  });
}

// =====================================================
// HELPERS
// =====================================================
function updateCameraStatus(message) {
  const status = document.getElementById("camera-status");
  if (status) status.textContent = message;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
