// EXERCISE 2 — everything bundled into one sketch file:
// 2.1 Audio CAPTCHA (acts like the “unlock gate”)
// 2.2 Music visualiser (driven by Meyda features)
// 2.3 Voice-controlled UI (change colors + shapes by speaking)

// -------------------------
// App state (shared across both screens)
// -------------------------
let appState = 'CAPTCHA'; // 'CAPTCHA' or 'VISUALIZER'

// -------------------------
// Task 2.1: CAPTCHA variables
// -------------------------
let myVoice;        // p5.Speech (reads the code out loud)
let noiseGen;       // Brown noise bed (adds a bit of chaos so the code isn’t “too clean”)
let captchaString = "";
let captchaInput, captchaSubmitBtn, captchaPlayBtn, captchaRefreshBtn;
let captchaMsg = "Listen and enter the code.";
let captchaColor = [255, 255, 255];
let freqData; // Frequency bins for the little bars shown under the Play button

// -------------------------
// Task 2.2 + 2.3: Visualiser + voice control variables
// -------------------------
let soundFile;
let analyzer;       // Meyda analyzer (rms + spectralCentroid)
let speechRec;      // Speech recognition helper
let visPlayBtn, visMicBtn;
let bgColor = 'black';
let shapeType = 'square';
let featureRMS = 0;
let featureCentroid = 0;
let voiceStatus = "Inactive";
let isListening = false; // Tracks whether I *intend* voice recognition to be running

// Music dropdown (lets me swap tracks without changing the rest of the logic)
let musicSelect;
const MUSIC_FILES = [
  'Kalte_Ohren_(_Remix_).mp3',
  'Ex2_sound1.wav',
  'Ex2_sound2.wav',
  'Ex2_sound3.wav'
];
let currentMusicPath = 'Kalte_Ohren_(_Remix_).mp3';

// CAPTCHA audio visual helpers:
// I attach an analyser to the p5 master output so it reacts to BOTH the TTS voice and the noise bed.
let waveAnalyser;   // WebAudio AnalyserNode (listens to p5 master output)
let waveData;       // Uint8Array buffer (time-domain)

function preload() {
  soundFormats('mp3', 'wav', 'ogg');

  // Load the default track up front so the visualiser is ready right after unlocking.
  soundFile = loadSound(
    currentMusicPath,
    () => {
      let status = document.getElementById('status');
      if (status) status.innerText = "System Ready";
    },
    () => {
      let status = document.getElementById('status');
      if (status) status.innerText = "Error Loading Audio";
      console.error("Audio failed to load");
    }
  );
}

// Track switching helper:
// This keeps play/pause behaviour consistent and rebuilds the Meyda hookup for the new track.
function loadSelectedTrack(path) {
  const wasPlaying = soundFile && soundFile.isPlaying();

  // Stop current playback first (clean swap = no overlap glitches).
  if (soundFile) {
    try { soundFile.stop(); } catch (e) {}
  }

  // Meyda hangs onto its old source, so I shut it down and recreate it per track.
  if (analyzer) {
    try { analyzer.stop(); } catch (e) {}
    analyzer = null;
  }

  currentMusicPath = path;

  soundFile = loadSound(
    currentMusicPath,
    () => {
      // If it was already playing before the swap, keep the “music is on” experience.
      if (wasPlaying) {
        soundFile.loop();
        visPlayBtn.html('⏸ Pause Music');
        setupMeyda();
        if (analyzer) analyzer.start();
      } else {
        // If it wasn’t playing, just leave it loaded and ready.
        if (visPlayBtn) visPlayBtn.html('▶️ Play Music');
      }
    },
    () => {
      console.error("Audio failed to load:", currentMusicPath);
      if (visPlayBtn) visPlayBtn.html('▶️ Play Music');
    }
  );
}

function setup() {
  let cnv = createCanvas(800, 600);
  cnv.parent('canvas-container');

  // CAPTCHA audio pieces
  myVoice = new p5.Speech();

  noiseGen = new p5.Noise();
  noiseGen.setType('brown');
  noiseGen.amp(0);
  noiseGen.start();

  // Hook an analyser to p5’s master output so the CAPTCHA bars react to real audio output.
  const ac = getAudioContext();
  waveAnalyser = ac.createAnalyser();
  waveAnalyser.fftSize = 1024;
  waveAnalyser.smoothingTimeConstant = 0.85;

  waveData = new Uint8Array(waveAnalyser.fftSize);
  freqData = new Uint8Array(waveAnalyser.frequencyBinCount);

  if (window.p5 && p5.soundOut && p5.soundOut.output) {
    p5.soundOut.output.connect(waveAnalyser);
  }

  // Voice recognition for task 2.3 (only used while in VISUALIZER mode).
  speechRec = new p5.SpeechRec('en-US', parseVoice);
  speechRec.continuous = true;      // Keep listening rather than one-shot
  speechRec.interimResults = false; // Only act on final results (less noise / fewer false triggers)

  // Some browsers end recognition unexpectedly, so this lets it “bounce back”.
  speechRec.onEnd = restartListening;

  // Build both UIs once, then I just show/hide depending on the current mode.
  setupCaptchaUI();
  setupVisualizerUI();

  // Start on the CAPTCHA gate
  setMode('CAPTCHA');
  generateCaptcha();
}

function draw() {
  // One draw loop, two screens. I branch here so the rest stays easier to follow.
  if (appState === 'CAPTCHA') {
    drawCaptchaScreen();
  } else {
    drawVisualizerScreen();
  }
}

// ======================================================
//                 MODE 1: CAPTCHA (Task 2.1)
// ======================================================

function setupCaptchaUI() {
  // “Play code” button
  captchaPlayBtn = createButton('🔊 Play Code');
  captchaPlayBtn.parent('canvas-container');
  captchaPlayBtn.position(280, 220);
  captchaPlayBtn.size(200, 50);
  captchaPlayBtn.style('font-size', '18px');
  captchaPlayBtn.mousePressed(playCaptchaAudio);

  // Input field for the user’s typed response
  captchaInput = createInput('');
  captchaInput.parent('canvas-container');
  captchaInput.position(300, 360);
  captchaInput.size(190, 30);
  captchaInput.attribute('placeholder', 'Enter Numbers...');

  // Unlock button (checks typed code)
  captchaSubmitBtn = createButton('Unlock');
  captchaSubmitBtn.parent('canvas-container');
  captchaSubmitBtn.position(300, 410);
  captchaSubmitBtn.size(200, 40);
  captchaSubmitBtn.style('background-color', '#4CAF50');
  captchaSubmitBtn.style('color', 'white');
  captchaSubmitBtn.mousePressed(checkCaptcha);

  // Refresh button (generates a new code)
  captchaRefreshBtn = createButton('🔄');
  captchaRefreshBtn.parent('canvas-container');
  captchaRefreshBtn.position(500, 220); // next to play button
  captchaRefreshBtn.size(40, 50);
  captchaRefreshBtn.mousePressed(generateCaptcha);
}

function drawCaptchaScreen() {
  background(40);

  // Big title so it reads clearly during demo/marking
  fill(255); noStroke(); textAlign(CENTER);
  textSize(32); text("🔒 SECURITY CHECK", width / 2, 70);

  textSize(16); fill(200);
  text("Task 2.1: Audio Captcha", width / 2, 100);

  fill(255); textSize(18);
  text("1. Turn up volume\n2. Click Play\n3. Enter the numbers you hear", width / 2, 150);

  // Mini bars under the Play button:
  // This makes the screen feel “alive” and also proves audio is actually outputting.
  drawBars(width / 2 - 140, 280, 280, 60);

  // Big feedback message near the bottom
  fill(captchaColor); textSize(24); textStyle(BOLD);
  text(captchaMsg, width / 2, 490);
  textStyle(NORMAL);
}

function generateCaptcha() {
  // 5 digits only (digits are easier to speak clearly and easier to type accurately).
  const chars = "0123456789";
  captchaString = "";
  for (let i = 0; i < 5; i++) {
    captchaString += chars.charAt(floor(random(chars.length)));
  }
  console.log("Secret Code:", captchaString);
  captchaMsg = "Waiting for input...";
  captchaColor = [255, 255, 255];
  captchaInput.value('');
}

function playCaptchaAudio() {
  userStartAudio();

  // Some browsers won’t play until AudioContext is running.
  const ac = getAudioContext();
  if (ac.state !== "running") ac.resume();

  // Fade in the noise bed, then speak the code over it.
  noiseGen.amp(0.3, 0.2);

  // Speak digits spaced out so it’s “one number at a time”.
  let spaced = captchaString.split('').join(' ');
  myVoice.setRate(0.8);
  myVoice.setPitch(random(0.9, 1.1));
  myVoice.speak(spaced);

  // Fade out noise after the voice has had time to finish.
  setTimeout(() => noiseGen.amp(0, 0.5), 3500);
}

function checkCaptcha() {
  // Straight compare is fine here because the CAPTCHA is digits-only.
  if (captchaInput.value() === captchaString) {
    captchaMsg = "ACCESS GRANTED";
    captchaColor = [0, 255, 0];
    setTimeout(() => setMode('VISUALIZER'), 1000);
  } else {
    captchaMsg = "ACCESS DENIED - Try Again";
    captchaColor = [255, 50, 50];
  }
}

// Bar visual used on the CAPTCHA screen (frequency-domain).
function drawBars(x, y, w, h) {
  push();

  // Panel background
  noStroke();
  fill(20);
  rectMode(CORNER);
  rect(x, y, w, h, 10);

  const ac = getAudioContext();
  if (ac.state !== "running" || !waveAnalyser || !freqData) {
    // If audio isn’t running yet, show a simple placeholder line (no “dead” empty box).
    stroke(120);
    line(x + 10, y + h / 2, x + w - 10, y + h / 2);
    pop();
    return;
  }

  // Read FFT bins (0..255)
  waveAnalyser.getByteFrequencyData(freqData);

  // Fixed bar layout so the UI doesn’t jitter around
  const barCount = 40;
  const gap = 2;
  const barW = (w - (barCount + 1) * gap) / barCount;

  // Sample bins across the spectrum and draw vertical bars
  noStroke();
  for (let i = 0; i < barCount; i++) {
    const idx = floor(map(i, 0, barCount - 1, 0, freqData.length - 1));
    const v = freqData[idx] / 255;
    const barH = v * (h - 12);
    const bx = x + gap + i * (barW + gap);
    const by = y + h - 6 - barH;

    // A bit of intensity shading so louder frequencies pop more
    fill(0, 255 * v, 180);
    rect(bx, by, barW, barH, 3);
  }

  pop();
}

// Time-domain waveform helper (not currently shown on the CAPTCHA screen, but kept ready).
function drawWaveform(x, y, w, h) {
  push();

  // Panel background
  noStroke();
  fill(20);
  rectMode(CORNER);
  rect(x, y, w, h, 10);

  const ac = getAudioContext();
  if (ac.state !== "running" || !waveAnalyser || !waveData) {
    // Same placeholder behaviour as drawBars
    stroke(120);
    noFill();
    line(x + 10, y + h / 2, x + w - 10, y + h / 2);
    pop();
    return;
  }

  // Read waveform samples (0..255)
  waveAnalyser.getByteTimeDomainData(waveData);

  // Draw centered waveform
  const midY = y + h / 2;

  noStroke();
  fill(0, 255, 180, 120);

  beginShape();
  vertex(x + 8, midY);

  for (let i = 0; i < waveData.length; i++) {
    const v = (waveData[i] - 128) / 128; // -1..1
    const px = map(i, 0, waveData.length - 1, x + 8, x + w - 8);
    const py = midY + v * (h * 0.4);
    vertex(px, py);
  }

  vertex(x + w - 8, midY);
  endShape(CLOSE);

  // Outline so it stays readable on dark backgrounds
  stroke(0, 255, 180);
  strokeWeight(2);
  noFill();
  beginShape();
  for (let i = 0; i < waveData.length; i++) {
    const v = (waveData[i] - 128) / 128;
    const px = map(i, 0, waveData.length - 1, x + 8, x + w - 8);
    const py = midY + v * (h * 0.4);
    vertex(px, py);
  }
  endShape();

  pop();
}

// ======================================================
//             MODE 2: VISUALIZER (Task 2.2 & 2.3)
// ======================================================

function setupVisualizerUI() {
  // Music play/pause
  visPlayBtn = createButton('▶️ Play Music');
  visPlayBtn.parent('canvas-container');
  visPlayBtn.position(20, 540);
  visPlayBtn.size(150, 40);
  visPlayBtn.mousePressed(toggleMusic);

  // Voice control toggle
  visMicBtn = createButton('🎤 Start Voice Control');
  visMicBtn.parent('canvas-container');
  visMicBtn.position(190, 540);
  visMicBtn.size(180, 40);
  visMicBtn.mousePressed(startVoiceRec);

  // Track dropdown (useful for demos + marking)
  musicSelect = createSelect();
  musicSelect.parent('canvas-container');
  musicSelect.position(390, 540);
  musicSelect.size(250, 40);
  musicSelect.style('font-size', '14px');

  for (let i = 0; i < MUSIC_FILES.length; i++) {
    musicSelect.option(MUSIC_FILES[i], MUSIC_FILES[i]);
  }
  musicSelect.value(currentMusicPath);

  musicSelect.changed(() => {
    loadSelectedTrack(musicSelect.value());
  });
}

function drawVisualizerScreen() {
  // Background is voice-controlled. Alpha is used so motion leaves a soft “trail”.
  if (bgColor === 'black') background(0, 20);
  else if (bgColor === 'white') background(255, 20);
  else if (bgColor === 'red') background(50, 0, 0, 20);
  else if (bgColor === 'blue') background(0, 0, 50, 20);
  else if (bgColor === 'green') background(0, 50, 0, 20);
  else if (bgColor === 'orange') background(80, 35, 0, 20);
  else if (bgColor === 'purple') background(40, 0, 60, 20);
  else if (bgColor === 'pink') background(70, 0, 30, 20);
  else if (bgColor === 'yellow') background(80, 80, 0, 20);
  else if (bgColor === 'cyan') background(0, 60, 60, 20);
  else if (bgColor === 'magenta') background(60, 0, 60, 20);
  else if (bgColor === 'teal') background(0, 60, 40, 20);
  else if (bgColor === 'grey') background(30, 30, 30, 20);

  // Quick “cheat sheet” so commands are obvious during demo
  fill(255); noStroke(); textAlign(LEFT); textSize(12);
  text("COMMANDS: Colors: Red/Green/Blue/Black/White/Orange/... | Shapes: Circle/Square/Triangle/Pentagon...", 20, 30);

  // Mic status indicator: green = listening, red-ish = off
  if (isListening) fill(0, 255, 0); else fill(255, 100, 100);
  text("Voice Status: " + voiceStatus, 20, 50);

  // Visuals draw from the center so rotations feel clean
  translate(width / 2, height / 2);

  // Spectral centroid loosely tracks “brightness”, so I use it for rotation + stroke tint
  let bright = map(featureCentroid, 0, 500, 50, 255);
  rotate(frameCount * 0.01 + (featureCentroid * 0.002));

  // RMS roughly tracks loudness, so it’s a natural size driver
  let size = map(featureRMS, 0, 0.5, 100, 500);

  noFill();
  strokeWeight(5);
  stroke(bright, 150, 255 - bright);

  // Voice chooses the shape; audio chooses movement/size
  if (shapeType === 'square') {
    rectMode(CENTER);
    rect(0, 0, size, size);
  } else if (shapeType === 'circle') {
    ellipse(0, 0, size, size);
  } else if (shapeType === 'triangle') {
    let h = size * (Math.sqrt(3) / 2);
    triangle(0, -h / 2, -size / 2, h / 2, size / 2, h / 2);
  } else if (shapeType === 'pentagon') {
    drawPolygon(0, 0, size / 2, 5);
  } else if (shapeType === 'rhombus') {
    drawRhombus(0, 0, size * 0.8, size * 0.8);
  } else if (shapeType === 'hexagon') {
    drawPolygon(0, 0, size / 2, 6);
  } else if (shapeType === 'octagon') {
    drawPolygon(0, 0, size / 2, 8);
  } else if (shapeType === 'star') {
    drawStar(0, 0, size * 0.25, size * 0.5, 5);
  } else if (shapeType === 'cross') {
    drawCross(0, 0, size * 0.9, size * 0.25);
  } else if (shapeType === 'heart') {
    drawHeart(0, 0, size * 0.6);
  }
}

function toggleMusic() {
  if (!soundFile) return;

  // Keep the button text in sync with the actual audio state
  if (soundFile.isPlaying()) {
    soundFile.pause();
    visPlayBtn.html('▶️ Play Music');
    if (analyzer) analyzer.stop();
  } else {
    soundFile.loop();
    visPlayBtn.html('⏸ Pause Music');
    setupMeyda(); // Attach analyzer to the current soundFile before starting it
    if (analyzer) analyzer.start();
  }
}

function setupMeyda() {
  // Create once per track and let the callback keep feature values updated.
  if (!analyzer && typeof Meyda !== 'undefined') {
    analyzer = Meyda.createMeydaAnalyzer({
      "audioContext": getAudioContext(),
      "source": soundFile,
      "bufferSize": 512,
      "featureExtractors": ["rms", "spectralCentroid"],
      "callback": (features) => {
        featureRMS = features.rms;
        featureCentroid = features.spectralCentroid;
      }
    });
  }
}

function startVoiceRec() {
  userStartAudio();
  if (!isListening) {
    try {
      isListening = true;
      speechRec.start(true, false); // start(continuous, interim)
      voiceStatus = "Listening... (Say 'Orange', 'Rhombus' etc.)";
      visMicBtn.html("🎤 Listening...");
      console.log("Microphone started");
    } catch (e) { console.error(e); }
  }
}

// If recognition ends by itself, this starts it again (but only if it *should* be running).
function restartListening() {
  if (isListening && appState === 'VISUALIZER') {
    console.log("Restarting voice recognition...");
    speechRec.start(true, false);
  }
}

function parseVoice() {
  if (speechRec.resultValue) {
    // Lowercase + substring checks keeps it simple and reliable for this coursework scope.
    let input = speechRec.resultString.toLowerCase();
    voiceStatus = "Heard: " + input;
    console.log("Voice Command Recognized:", input);

    // Colors
    if (input.includes('red')) bgColor = 'red';
    if (input.includes('green')) bgColor = 'green';
    if (input.includes('blue')) bgColor = 'blue';
    if (input.includes('black')) bgColor = 'black';
    if (input.includes('white')) bgColor = 'white';
    if (input.includes('orange')) bgColor = 'orange';
    if (input.includes('purple')) bgColor = 'purple';
    if (input.includes('pink')) bgColor = 'pink';
    if (input.includes('yellow')) bgColor = 'yellow';
    if (input.includes('cyan')) bgColor = 'cyan';
    if (input.includes('magenta')) bgColor = 'magenta';
    if (input.includes('teal')) bgColor = 'teal';
    if (input.includes('gray') || input.includes('grey')) bgColor = 'grey';

    // Shapes
    if (input.includes('square')) shapeType = 'square';
    if (input.includes('circle')) shapeType = 'circle';
    if (input.includes('triangle')) shapeType = 'triangle';
    if (input.includes('pentagon')) shapeType = 'pentagon';
    if (input.includes('rhombus') || input.includes('diamond')) shapeType = 'rhombus';
    if (input.includes('hexagon')) shapeType = 'hexagon';
    if (input.includes('octagon')) shapeType = 'octagon';
    if (input.includes('star')) shapeType = 'star';
    if (input.includes('cross') || input.includes('plus')) shapeType = 'cross';
    if (input.includes('heart')) shapeType = 'heart';
  }
}

function drawPolygon(x, y, radius, npoints) {
  // Generic polygon helper (handy for pentagon/hexagon/octagon without repeating logic).
  let angle = TWO_PI / npoints;
  beginShape();
  for (let a = 0; a < TWO_PI; a += angle) {
    let sx = x + cos(a) * radius;
    let sy = y + sin(a) * radius;
    vertex(sx, sy);
  }
  endShape(CLOSE);
}

// Extra shape helpers (kept small and predictable so the main draw loop stays clean)
function drawRhombus(x, y, w, h) {
  beginShape();
  vertex(x, y - h / 2);
  vertex(x + w / 2, y);
  vertex(x, y + h / 2);
  vertex(x - w / 2, y);
  endShape(CLOSE);
}

function drawStar(x, y, radius1, radius2, npoints) {
  let angle = TWO_PI / npoints;
  let halfAngle = angle / 2.0;
  beginShape();
  for (let a = 0; a < TWO_PI; a += angle) {
    let sx = x + cos(a) * radius2;
    let sy = y + sin(a) * radius2;
    vertex(sx, sy);
    sx = x + cos(a + halfAngle) * radius1;
    sy = y + sin(a + halfAngle) * radius1;
    vertex(sx, sy);
  }
  endShape(CLOSE);
}

function drawCross(x, y, size, thickness) {
  rectMode(CENTER);
  rect(x, y, thickness, size);
  rect(x, y, size, thickness);
}

function drawHeart(x, y, s) {
  beginShape();
  vertex(x, y);
  bezierVertex(x - s, y - s, x - s * 1.4, y + s * 0.4, x, y + s);
  bezierVertex(x + s * 1.4, y + s * 0.4, x + s, y - s, x, y);
  endShape(CLOSE);
}

// ======================================================
//                   HELPER FUNCTIONS
// ======================================================

function setMode(mode) {
  appState = mode;

  if (mode === 'CAPTCHA') {
    // CAPTCHA UI on…
    captchaPlayBtn.show(); captchaInput.show(); captchaSubmitBtn.show(); captchaRefreshBtn.show();
    // …visualiser UI off.
    visPlayBtn.hide(); visMicBtn.hide();
    if (musicSelect) musicSelect.hide();

    // Don’t keep voice recognition “running” while on the CAPTCHA screen.
    isListening = false;
  } else {
    // Visualiser UI on…
    captchaPlayBtn.hide(); captchaInput.hide(); captchaSubmitBtn.hide(); captchaRefreshBtn.hide();
    // …CAPTCHA UI off.
    visPlayBtn.show(); visMicBtn.show();
    if (musicSelect) musicSelect.show();

    // Make sure the CAPTCHA noise isn’t lingering once I switch screens.
    noiseGen.stop();
  }
}
