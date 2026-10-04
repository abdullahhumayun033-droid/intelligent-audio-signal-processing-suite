// ============================================================
// CM3065 – Exercise 1 (UPGRADED)
// What I added/changed here:
// A) “Choose from device” import → saves into a slot and shows in the library
// B) Library rows now show the source + filename + a “filters saved” note
// C) Filters persist per slot and reload when I open that slot again (IndexedDB + localStorage fallback)
// D) Recording is saved in a more reliable way and appears in the library for edit/delete later
// ============================================================

// ---------- CHANGE THESE FILENAMES / PATHS IF YOUR PRESET WAVs DIFFER ----------
// These are the default preset files for Sound 1–6. If your WAVs have different names
// or live in a different folder, update the paths here.
const PRESETS = {
  sound1: "Ex1_sound1.wav",
  sound2: "Ex1_sound2.wav",
  sound3: "Ex1_sound3.wav",
  sound4: "Ex1_sound4.wav",
  sound5: "Ex1_sound5.wav",
  sound6: "Ex1_sound6.wav",
};

// ---------- IndexedDB: store BOTH audio blob AND cfg per slot ----------
// I store each slot’s audio (recorded/imported) + its effect settings so the library survives refreshes.
const DB_NAME = "cm3065_ex1_slots_db";
const STORE = "slots";
let db = null;

function openDB() {
  // Opens the DB (or creates it on first run). The store is keyed by slot name (e.g., "sound1").
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(STORE)) {
        d.createObjectStore(STORE, { keyPath: "slot" });
      }
    };
    req.onsuccess = () => { db = req.result; resolve(); };
    req.onerror = () => reject(req.error);
  });
}

function dbPut(record) {
  // Insert/update a slot record (audio blob + metadata + saved filter config).
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function dbGet(slot) {
  // Fetch one slot record. Returns null if nothing is saved for that slot yet.
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(slot);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

function dbGetAll() {
  // Pull everything so I can rebuild the library list UI in one pass.
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function dbDelete(slot) {
  // Remove a slot’s saved audio/config so it falls back to the preset again.
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(slot);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------- LocalStorage fallback for cfg ----------
// If IndexedDB is blocked/unavailable, I still try to keep filter settings using localStorage.
function cfgKey(slot) { return `cm3065_ex1_cfg_${slot}`; }
function saveCfgFallback(slot, cfg) { localStorage.setItem(cfgKey(slot), JSON.stringify(cfg)); }
function loadCfgFallback(slot) {
  // Safe parse: if anything looks wrong, I just return null and carry on with defaults.
  try {
    const raw = localStorage.getItem(cfgKey(slot));
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

// ---------- DOM ----------
// Small helper so I can write $("id") instead of document.getElementById("id") everywhere.
const $ = (id) => document.getElementById(id);
let el = {};

function status(msg) {
  // Single place for status text so messages stay consistent.
  if (el.status) el.status.textContent = msg;
}

// ---------- Audio + state ----------
let audioStarted = false;

let currentSlot = null;
let currentSound = null;
let isLooping = false;

// Recording
let isRecording = false;
let liveStream = null;
let liveNode = null;

// Effects chain (Figure 2)
let lowpass, distortion, compressor, reverb, masterGain;

// FFT
let fftIn, fftOut;

// Recorder captures processed output (post-masterGain)
let recorder, recordedFile;

// Library selection
let selectedSlotInList = null;

// -------- NEW: Choose-from-device (file picker) ----------
// I inject a hidden file input + a visible button at runtime (so no HTML edits are required).
let filePickerEl = null;        // hidden <input type="file">
let chooseBtnEl = null;         // visible button I inject next to Record New

// ============================================================
// SAFETY: Never crash on missing/invalid audio
// ============================================================
// p5.sound can fail hard (or quietly) if a file is missing/corrupt. This wrapper keeps the app alive
// and shows a clear message instead of breaking the whole page.
function safeLoadSound(pathOrUrl, onOk, onFailMsg) {
  try {
    return loadSound(
      pathOrUrl,
      () => { if (onOk) onOk(); },
      (err) => {
        status(onFailMsg || `❌ Failed to load audio: ${pathOrUrl}`);
        console.error("loadSound error:", pathOrUrl, err);
      }
    );
  } catch (e) {
    status(onFailMsg || `❌ Audio load crashed: ${pathOrUrl}`);
    console.error(e);
    return null;
  }
}

function hasValidBuffer(sf) {
  // p5.SoundFile only gets .buffer after decoding. If it's missing, the decode likely failed.
  return !!(sf && sf.buffer);
}

// ---------- p5 ----------
function setup() {
  const c = createCanvas(760, 200);
  c.parent(document.querySelector("main"));

  lowpass = new p5.LowPass();
  distortion = new p5.Distortion();
  compressor = new p5.Compressor();
  reverb = new p5.Reverb();
  masterGain = new p5.Gain();

  // I analyze both input and output so the two spectrums actually mean something.
  fftIn = new p5.FFT(0.8, 1024);
  fftOut = new p5.FFT(0.8, 1024);

  // By default I point the recorder at the processed output (after masterGain).
  recorder = new p5.SoundRecorder();
  recorder.setInput(masterGain);
  recordedFile = new p5.SoundFile();

  hookUI();
  setupChooseFromDeviceUI(); // added by me

  openDB()
    .then(refreshLibraryList)
    .then(() => status("Ready. Load Sound 1–6 or Choose from device, then Play. Record New saves into the library."))
    .catch((e) => {
      console.error(e);
      status("IndexedDB blocked/unavailable. Recording/library persistence may not work.");
    });

  // I only start drawing continuously once audio is started (keeps the page lighter at idle).
  noLoop();
}

function draw() {
  background(255);

  // Simple two-panel layout: left = input spectrum, right = processed output spectrum.
  stroke(30);
  noFill();
  rect(10, 25, width / 2 - 20, height - 45, 12);
  rect(width / 2 + 10, 25, width / 2 - 20, height - 45, 12);

  noStroke();
  fill(0);
  textStyle(BOLD);
  text("Spectrum In", 20, 18);
  text("Spectrum Out", width / 2 + 20, 18);

  // Until the AudioContext is unlocked, I show a friendly hint instead of empty charts.
  if (!audioStarted) {
    fill(80);
    textStyle(NORMAL);
    text("Click a Sound button, Choose from device, or Record New to start audio.", 28, 108);
    return;
  }

  const inSpec = fftIn.analyze();
  const outSpec = fftOut.analyze();

  drawBars(inSpec, 20, 40, width / 2 - 40, height - 70);
  drawBars(outSpec, width / 2 + 20, 40, width / 2 - 40, height - 70);
}

function drawBars(spec, x, y, w, h) {
  // Lightweight spectrum bars (kept intentionally simple and readable).
  noStroke();
  fill(40);

  const bars = 96;
  const step = Math.max(1, Math.floor(spec.length / bars));
  const bw = w / bars;

  for (let i = 0; i < bars; i++) {
    const v = spec[i * step] / 255;
    const bh = v * h;
    rect(x + i * bw, y + (h - bh), bw * 0.85, bh);
  }
}

// ---------- Audio start ----------
async function ensureAudio() {
  // Some browsers require a user gesture before audio can start. This makes sure that’s done once.
  if (audioStarted) return;
  await userStartAudio();
  audioStarted = true;
  loop();
  status("Audio started.");
}

// ---------- UI hookup ----------
function hookUI() {
  el.status = $("status");

  el.playPauseBtn = $("playPauseBtn");
  el.stopBtn = $("stopBtn");
  el.loopBtn = $("loopBtn");
  el.skipBtn = $("skipBtn");

  el.sound1Btn = $("sound1Btn");
  el.sound2Btn = $("sound2Btn");
  el.sound3Btn = $("sound3Btn");
  el.sound4Btn = $("sound4Btn");
  el.sound5Btn = $("sound5Btn");
  el.sound6Btn = $("sound6Btn");

  el.editBtn = $("editBtn");
  el.deleteBtn = $("deleteBtn");
  el.recordNewBtn = $("recordNewBtn");

  el.libraryList = $("libraryList");

  el.recMic = $("recMic");
  el.recSystem = $("recSystem");

  el.masterVol = $("masterVol");

  el.lpCut = $("lpCut");
  el.lpRes = $("lpRes");
  el.lpDW = $("lpDW");
  el.lpOL = $("lpOL");

  el.rvDur = $("rvDur");
  el.rvDecay = $("rvDecay");
  el.rvRev = $("rvRev");
  el.rvDW = $("rvDW");
  el.rvOL = $("rvOL");

  el.cpAtk = $("cpAtk");
  el.cpKnee = $("cpKnee");
  el.cpRel = $("cpRel");
  el.cpRatio = $("cpRatio");
  el.cpThr = $("cpThr");
  el.cpDW = $("cpDW");
  el.cpOL = $("cpOL");

  el.dsAmt = $("dsAmt");
  el.dsOver = $("dsOver");
  el.dsDW = $("dsDW");
  el.dsOL = $("dsOL");

  el.clearBtn = $("clearBtn");
  el.saveBtn = $("saveBtn");

  // Slot buttons (Sound 1–6)
  if (el.sound1Btn) el.sound1Btn.onclick = () => loadSlot("sound1");
  if (el.sound2Btn) el.sound2Btn.onclick = () => loadSlot("sound2");
  if (el.sound3Btn) el.sound3Btn.onclick = () => loadSlot("sound3");
  if (el.sound4Btn) el.sound4Btn.onclick = () => loadSlot("sound4");
  if (el.sound5Btn) el.sound5Btn.onclick = () => loadSlot("sound5");
  if (el.sound6Btn) el.sound6Btn.onclick = () => loadSlot("sound6");

  // Playback controls
  if (el.playPauseBtn) el.playPauseBtn.onclick = () => togglePlayPause();
  if (el.stopBtn) el.stopBtn.onclick = () => stopPlayback(false);
  if (el.loopBtn) el.loopBtn.onclick = () => toggleLoop();
  if (el.skipBtn) el.skipBtn.onclick = () => skipToStart();

  // Library actions
  if (el.editBtn) el.editBtn.onclick = () => editSelected();
  if (el.deleteBtn) el.deleteBtn.onclick = () => deleteSelected();
  if (el.recordNewBtn) el.recordNewBtn.onclick = () => toggleRecord();

  // Apply effects live while sliders move (checkbox/select use change, sliders use input)
  const allInputs = [
    el.masterVol,
    el.lpCut, el.lpRes, el.lpDW, el.lpOL,
    el.rvDur, el.rvDecay, el.rvRev, el.rvDW, el.rvOL,
    el.cpAtk, el.cpKnee, el.cpRel, el.cpRatio, el.cpThr, el.cpDW, el.cpOL,
    el.dsAmt, el.dsOver, el.dsDW, el.dsOL
  ].filter(Boolean);

  allInputs.forEach((x) => {
    const evt = (x.type === "checkbox" || x.tagName === "SELECT") ? "change" : "input";
    x.addEventListener(evt, applyEffects);
  });

  if (el.clearBtn) el.clearBtn.onclick = () => clearFilters();
  if (el.saveBtn) el.saveBtn.onclick = () => saveCurrentEffects();
}

// ============================================================
// NEW: Choose-from-device UI (no HTML changes required)
// ============================================================
// I create a hidden file input, then trigger it from a normal button.
// When a file is chosen, it gets saved into a slot as a blob.
function setupChooseFromDeviceUI() {
  // Create hidden file input
  filePickerEl = document.createElement("input");
  filePickerEl.type = "file";
  filePickerEl.accept = "audio/*,.wav,.mp3,.ogg,.m4a";
  filePickerEl.style.display = "none";
  document.body.appendChild(filePickerEl);

  filePickerEl.addEventListener("change", async (e) => {
    const f = e.target.files && e.target.files[0];
    // Resetting at the end lets the same file be selected twice in a row.
    try {
      if (!f) return;
      await ensureAudio();
      await importAudioFileToLibrary(f);
    } finally {
      filePickerEl.value = "";
    }
  });

  // Create visible button near Record New (if present)
  chooseBtnEl = document.createElement("button");
  chooseBtnEl.type = "button";
  chooseBtnEl.textContent = "Choose from device";
  chooseBtnEl.style.marginLeft = "8px";

  chooseBtnEl.onclick = async () => {
    await ensureAudio();
    filePickerEl.click();
  };

  // Prefer inserting next to the existing “Record New” button so it feels like part of the UI.
  if (el.recordNewBtn && el.recordNewBtn.parentNode) {
    el.recordNewBtn.parentNode.insertBefore(chooseBtnEl, el.recordNewBtn.nextSibling);
  } else {
    document.body.appendChild(chooseBtnEl);
  }
}

async function importAudioFileToLibrary(file) {
  // Import target rule:
  // - If a slot is selected in the library, I overwrite that slot
  // - Otherwise I pick the first empty slot
  const targetSlot = selectedSlotInList || await findFirstAvailableSlot();
  status(`Importing "${file.name}" into ${targetSlot.toUpperCase()}...`);

  const blob = new Blob([await file.arrayBuffer()], { type: file.type || "audio/wav" });

  // Quick sanity check so I don’t save empty data and confuse the library.
  if (!blob || blob.size === 0) {
    status("❌ Import failed: file was empty.");
    return;
  }

  // I snapshot the current slider values so the imported sound carries the same “project state”.
  const cfg = currentCfg();
  await dbPut({
    slot: targetSlot,
    blob,
    name: file.name,
    source: "imported",
    savedAt: Date.now(),
    cfg
  });
  saveCfgFallback(targetSlot, cfg);

  await refreshLibraryList();
  await loadSlot(targetSlot);

  status(`✅ Imported "${file.name}" into ${targetSlot.toUpperCase()} (now editable in library).`);
}

// ---------- Active button highlighting ----------
function setActiveSlotButton(slot) {
  // Purely visual: keeps the selected Sound button highlighted.
  const map = {
    sound1: el.sound1Btn, sound2: el.sound2Btn, sound3: el.sound3Btn,
    sound4: el.sound4Btn, sound5: el.sound5Btn, sound6: el.sound6Btn
  };
  Object.keys(map).forEach(k => {
    if (map[k]) map[k].classList.toggle("active", k === slot);
  });
}

// ---------- Build config from UI ----------
function currentCfg() {
  // Read the UI once and store it as a plain object (easy to save/reload per slot).
  return {
    masterVol: +el.masterVol.value,

    lpCut: +el.lpCut.value,
    lpRes: +el.lpRes.value,
    lpDW: +el.lpDW.value,
    lpOL: +el.lpOL.value,

    rvDur: +el.rvDur.value,
    rvDecay: +el.rvDecay.value,
    rvRev: !!el.rvRev.checked,
    rvDW: +el.rvDW.value,
    rvOL: +el.rvOL.value,

    cpAtk: +el.cpAtk.value,
    cpKnee: +el.cpKnee.value,
    cpRel: +el.cpRel.value,
    cpRatio: +el.cpRatio.value,
    cpThr: +el.cpThr.value,
    cpDW: +el.cpDW.value,
    cpOL: +el.cpOL.value,

    dsAmt: +el.dsAmt.value,
    dsOver: el.dsOver.value,
    dsDW: +el.dsDW.value,
    dsOL: +el.dsOL.value
  };
}

function applyCfg(cfg) {
  // Apply a saved config back onto the UI controls, then push it into the effect nodes.
  if (!cfg) return;

  el.masterVol.value = cfg.masterVol ?? el.masterVol.value;

  el.lpCut.value = cfg.lpCut ?? el.lpCut.value;
  el.lpRes.value = cfg.lpRes ?? el.lpRes.value;
  el.lpDW.value  = cfg.lpDW  ?? el.lpDW.value;
  el.lpOL.value  = cfg.lpOL  ?? el.lpOL.value;

  el.rvDur.value = cfg.rvDur ?? el.rvDur.value;
  el.rvDecay.value = cfg.rvDecay ?? el.rvDecay.value;
  el.rvRev.checked = cfg.rvRev ?? el.rvRev.checked;
  el.rvDW.value = cfg.rvDW ?? el.rvDW.value;
  el.rvOL.value = cfg.rvOL ?? el.rvOL.value;

  el.cpAtk.value = cfg.cpAtk ?? el.cpAtk.value;
  el.cpKnee.value = cfg.cpKnee ?? el.cpKnee.value;
  el.cpRel.value = cfg.cpRel ?? el.cpRel.value;
  el.cpRatio.value = cfg.cpRatio ?? el.cpRatio.value;
  el.cpThr.value = cfg.cpThr ?? el.cpThr.value;
  el.cpDW.value = cfg.cpDW ?? el.cpDW.value;
  el.cpOL.value = cfg.cpOL ?? el.cpOL.value;

  el.dsAmt.value = cfg.dsAmt ?? el.dsAmt.value;
  el.dsOver.value = cfg.dsOver ?? el.dsOver.value;
  el.dsDW.value = cfg.dsDW ?? el.dsDW.value;
  el.dsOL.value = cfg.dsOL ?? el.dsOL.value;

  applyEffects();
}

// ---------- Apply effects (Figure 2 order) ----------
function applyEffects() {
  // This runs every time a slider changes (and also after loading a saved config).
  if (!audioStarted) return;

  lowpass.freq(+el.lpCut.value);
  lowpass.res(+el.lpRes.value);
  lowpass.drywet(+el.lpDW.value);
  lowpass.amp(+el.lpOL.value);

  distortion.set(+el.dsAmt.value, el.dsOver.value);
  distortion.drywet(+el.dsDW.value);
  distortion.amp(+el.dsOL.value);

  compressor.set(
    +el.cpAtk.value,
    +el.cpKnee.value,
    +el.cpRatio.value,
    +el.cpThr.value,
    +el.cpRel.value
  );
  compressor.drywet(+el.cpDW.value);
  compressor.amp(+el.cpOL.value);

  reverb.set(+el.rvDur.value, +el.rvDecay.value, !!el.rvRev.checked);
  reverb.drywet(+el.rvDW.value);
  reverb.amp(+el.rvOL.value);

  masterGain.amp(+el.masterVol.value);
}

// ---------- Connect chain for file playback ----------
function connectFileChain() {
  // For loaded sound files: SoundFile → Lowpass → Distortion → Compressor → Reverb → MasterGain → speakers
  if (!currentSound) return;

  if (!hasValidBuffer(currentSound)) {
    status("❌ Audio buffer is invalid (missing file or failed decode). Fix WAV path.");
    return;
  }

  // I disconnect first to avoid “double routing” if the user loads multiple slots in a row.
  currentSound.disconnect();
  lowpass.disconnect();
  distortion.disconnect();
  compressor.disconnect();
  reverb.disconnect();
  masterGain.disconnect();

  currentSound.connect(lowpass);
  lowpass.connect(distortion);
  distortion.connect(compressor);
  compressor.connect(reverb);
  reverb.connect(masterGain);
  masterGain.connect(); // to speakers

  // Input FFT = raw file, Output FFT = post-effects output
  fftIn.setInput(currentSound);
  fftOut.setInput(masterGain);

  applyEffects();
}

// ---------- Connect chain for live stream (mic/system) ----------
function connectLiveChain(webAudioSourceNode) {
  // Same effect chain, but the source is a MediaStream (mic or tab/system audio).
  if (!webAudioSourceNode) return;

  const ac = getAudioContext();

  lowpass.disconnect();
  distortion.disconnect();
  compressor.disconnect();
  reverb.disconnect();
  masterGain.disconnect();

  // Some browsers throw if disconnecting a node that isn’t connected yet, so I keep this guarded.
  try { webAudioSourceNode.disconnect(); } catch (e) {}

  webAudioSourceNode.connect(lowpass.input);
  lowpass.connect(distortion);
  distortion.connect(compressor);
  compressor.connect(reverb);
  reverb.connect(masterGain);

  masterGain.output.connect(ac.destination);

  // Here input FFT is the pre-FX signal (I point it at the lowpass stage),
  // and output FFT is the post-FX stage (masterGain).
  fftIn.setInput(lowpass);
  fftOut.setInput(masterGain);

  applyEffects();
}

// ---------- Slot loading (restores cfg) ----------
async function loadSlot(slot) {
  // Loads audio for a slot (saved blob first, otherwise fallback to preset), then reapplies saved filters.
  await ensureAudio();

  stopPlayback(true);
  currentSlot = slot;
  setActiveSlotButton(slot);

  const record = await dbGet(slot);
  const cfg = (record && record.cfg) ? record.cfg : loadCfgFallback(slot);

  if (record && record.blob) {
    // Saved audio path: turn blob into an object URL and load it like a normal sound file.
    const url = URL.createObjectURL(record.blob);
    const n = record.name ? ` (${record.name})` : "";
    status(`Loading ${slot.toUpperCase()}${n}...`);

    currentSound = safeLoadSound(
      url,
      () => {
        connectFileChain();
        applyCfg(cfg);
        status(`${slot.toUpperCase()} loaded. Press Play.`);
      },
      `❌ Failed to load saved audio for ${slot.toUpperCase()} (corrupt/empty).`
    );

    return;
  }

  // No saved audio: fallback to preset
  const file = PRESETS[slot];
  status(`Loading ${slot.toUpperCase()} (${file})...`);

  currentSound = safeLoadSound(
    file,
    () => {
      connectFileChain();
      applyCfg(cfg);
      status(`${slot.toUpperCase()} loaded. Press Play.`);
    },
    `❌ Missing preset WAV: ${file} (put it next to index.html or fix PRESETS path).`
  );
}

// ---------- Playback controls ----------
function togglePlayPause() {
  ensureAudio().then(() => {
    if (!currentSound) {
      status("Load a sound first (Sound 1–6) or Choose from device.");
      return;
    }
    if (!hasValidBuffer(currentSound)) {
      status("❌ This sound failed to load (0 frames). Fix file path / missing wav.");
      return;
    }
    if (currentSound.isPlaying()) {
      currentSound.pause();
      status("Paused.");
    } else {
      currentSound.play();
      currentSound.setLoop(isLooping);
      status("Playing.");
    }
  });
}

function stopPlayback(silent) {
  // Stops playback cleanly. The silent flag is used when switching sources so it doesn’t spam status text.
  if (currentSound) {
    try { currentSound.stop(); } catch (e) {}
  }
  if (!silent) status("Stopped.");
}

function toggleLoop() {
  // Loop is tracked separately so it can be applied consistently whenever playback starts.
  isLooping = !isLooping;
  if (currentSound && hasValidBuffer(currentSound)) currentSound.setLoop(isLooping);
  status(isLooping ? "Loop ON." : "Loop OFF.");
}

function skipToStart() {
  // Jump back to time=0 without needing to stop and re-play.
  if (!currentSound) { status("Load a sound first."); return; }
  if (!hasValidBuffer(currentSound)) { status("❌ Sound invalid (failed decode)."); return; }
  currentSound.jump(0);
  status("Skipped to start.");
}

// ---------- Clear filters ----------
function clearFilters() {
  // Reset everything back to a predictable baseline so testing is easier.
  const defaults = {
    masterVol: 0.8,
    lpCut: 2500, lpRes: 1.2, lpDW: 0.7, lpOL: 1.0,
    rvDur: 2.5, rvDecay: 3.0, rvRev: false, rvDW: 0.0, rvOL: 1.0,
    cpAtk: 0.02, cpKnee: 10, cpRel: 0.25, cpRatio: 4, cpThr: -18, cpDW: 1.0, cpOL: 1.0,
    dsAmt: 0.0, dsOver: "none", dsDW: 0.0, dsOL: 1.0
  };
  applyCfg(defaults);
  status("Filters cleared (defaults).");
}

// ---------- Save effects (writes cfg into slot record) ----------
async function saveCurrentEffects() {
  // Saves the current slider/checkbox values into the current slot record.
  if (!currentSlot) {
    status("Select a Sound slot first (Sound 1–6), then Save.");
    return;
  }

  const cfg = currentCfg();

  const existing = await dbGet(currentSlot);
  const updated = {
    slot: currentSlot,
    blob: existing ? existing.blob : null,
    name: existing ? existing.name : null,
    source: existing ? existing.source : null,
    savedAt: existing ? existing.savedAt : null,
    cfg: cfg
  };

  await dbPut(updated);
  saveCfgFallback(currentSlot, cfg);

  status(`Saved filter settings for ${currentSlot.toUpperCase()} (restores on reopen).`);
  refreshLibraryList();
}

// ---------- Library list rendering ----------
async function refreshLibraryList() {
  // Rebuilds the library panel so it always reflects what’s stored in IndexedDB/localStorage.
  if (!el.libraryList) return;

  const savedSlots = await dbGetAll();
  const savedMap = new Map(savedSlots.map(x => [x.slot, x]));
  const slots = ["sound1","sound2","sound3","sound4","sound5","sound6"];

  el.libraryList.innerHTML = "";

  for (const slot of slots) {
    const rec = savedMap.get(slot);

    const hasAudio = !!(rec && rec.blob);
    const hasCfg = !!(rec && rec.cfg) || !!loadCfgFallback(slot);

    const row = document.createElement("div");
    row.className = "libRow";
    row.dataset.slot = slot;

    const name = document.createElement("div");
    name.className = "libName";
    name.textContent = slot.toUpperCase();

    const tag = document.createElement("div");
    tag.className = "libTag";

    // Label where the slot’s current audio comes from (preset vs recorded vs imported).
    let sourceLabel = "Preset";
    if (hasAudio) {
      if (rec && rec.source === "imported") sourceLabel = "Imported";
      else sourceLabel = "Recorded";
    }

    const fname = (rec && rec.name) ? ` | ${rec.name}` : "";
    const cfgLabel = hasCfg ? " | Filters saved" : "";
    tag.textContent = `${sourceLabel}${fname}${cfgLabel}`;

    row.appendChild(name);
    row.appendChild(tag);

    row.onclick = () => {
      // This only selects the slot in the library UI (actual “open” happens via Edit).
      selectedSlotInList = slot;
      Array.from(el.libraryList.querySelectorAll(".libRow")).forEach(r => {
        r.classList.toggle("selected", r.dataset.slot === slot);
      });
      status(`Selected ${slot.toUpperCase()} in library list.`);
    };

    el.libraryList.appendChild(row);
  }
}

// ---------- Edit / Delete ----------
function editSelected() {
  // Edit simply loads the selected slot so the user can tweak effects and hit Save.
  const slot = selectedSlotInList || currentSlot;
  if (!slot) { status("Select a slot in the list, then Edit."); return; }
  loadSlot(slot);
  status(`Editing ${slot.toUpperCase()}: adjust filters then press Save.`);
}

async function deleteSelected() {
  // Deletes stored audio/config for that slot so it returns to preset state.
  const slot = selectedSlotInList || currentSlot;
  if (!slot) { status("Select a slot in the list, then Delete."); return; }

  await dbDelete(slot);
  localStorage.removeItem(cfgKey(slot));

  if (currentSlot === slot) {
    stopPlayback(true);
    currentSound = null;
  }

  status(`${slot.toUpperCase()} reset to preset (audio + filters removed).`);
  refreshLibraryList();
}

// ---------- Recording ----------
async function toggleRecord() {
  // One button toggles record start/stop so the UI stays simple.
  await ensureAudio();

  if (isRecording) {
    stopRecord();
  } else {
    startRecord();
  }
}

let recordFinalizeTimer = null;

async function startRecord() {
  try {
    // Most browsers block getUserMedia/getDisplayMedia on file://
    if (location.protocol === "file:") {
      status("❌ Recording blocked on file://. Use Live Server (http://127.0.0.1).");
      return;
    }

    // Clear any previous finalize timer so it doesn’t interfere with a new recording.
    if (recordFinalizeTimer) {
      clearTimeout(recordFinalizeTimer);
      recordFinalizeTimer = null;
    }

    // ---- Request stream ----
    if (el.recSystem && el.recSystem.checked) {
      status("Select a TAB and tick 'Share tab audio'...");
      liveStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    } else {
      status("Requesting microphone permission...");
      liveStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    }

    // ---- Validate audio track exists ----
    const audioTracks = liveStream.getAudioTracks();
    if (!audioTracks || audioTracks.length === 0) {
      cleanupLiveStream();
      status("❌ No audio track detected. (System: share a TAB + tick 'Share tab audio').");
      return;
    }

    // If the track exists but isn’t active, I stop early instead of recording silence.
    const t = audioTracks[0];
    if (t.readyState === "ended" || t.enabled === false) {
      cleanupLiveStream();
      status("❌ Audio track is not active. Re-allow permissions and try again.");
      return;
    }

    // ---- Build live chain ----
    const ac = getAudioContext();
    liveNode = ac.createMediaStreamSource(liveStream);

    // Route live audio through the FX chain so the user hears processed audio.
    connectLiveChain(liveNode);

    // Recorder input is set to the live chain start so it captures what’s actually flowing through.
    // This is the main fix for “0 frames” type recording issues.
    recorder.setInput(lowpass);

    // Small warm-up helps after the permission dialog (some browsers need a moment).
    await new Promise((r) => setTimeout(r, 250));

    // ---- Start recording ----
    recordedFile = new p5.SoundFile();
    let callbackFired = false;

    recorder.record(recordedFile, undefined, async () => {
      callbackFired = true;

      if (recordFinalizeTimer) {
        clearTimeout(recordFinalizeTimer);
        recordFinalizeTimer = null;
      }

      try {
        // HARD GUARDS: no buffer = no usable recording
        if (!recordedFile || !recordedFile.buffer) {
          status("❌ Recording produced no buffer. Check permissions + ensure input has sound.");
          return;
        }

        const len = recordedFile.buffer.length || 0;
        if (len <= 0) {
          status("❌ Recorded 0 frames (silent/empty). Record 2–3s + ensure sound is playing.");
          return;
        }

        let blob;
        try {
          blob = recordedFile.getBlob();
        } catch (e) {
          console.error("getBlob failed:", e);
          status("❌ Could not export recording. Try recording longer (2–3s).");
          return;
        }

        if (!blob || !(blob instanceof Blob) || blob.size === 0) {
          status("❌ Recording blob empty. Check mic/tab audio + record longer.");
          return;
        }

        // Save into the first available slot (or overwrite sound1 if everything is full).
        const targetSlot = await findFirstAvailableSlot();
        const cfg = currentCfg();

        await dbPut({
          slot: targetSlot,
          blob,
          name: `${targetSlot}_recording.wav`,
          source: "recorded",
          savedAt: Date.now(),
          cfg
        });

        saveCfgFallback(targetSlot, cfg);

        await refreshLibraryList();
        await loadSlot(targetSlot);

        status(`✅ Recording saved into ${targetSlot.toUpperCase()} (${blob.size} bytes)`);
        saveSound(recordedFile, `${targetSlot}_recording.wav`);
      } catch (err) {
        console.error(err);
        status("❌ Error saving recording: " + (err?.message || err));
      } finally {
        // Always shut down the live stream so the browser stops showing “capturing” indicators.
        cleanupLiveStream();

        // Put recorder input back to the processed output by default.
        recorder.setInput(masterGain);
      }
    });

    isRecording = true;
    status("Recording... click Record New again to stop.");

    // If the callback never fires, this prevents the app from getting stuck in “finalizing”.
    recordFinalizeTimer = setTimeout(() => {
      if (!callbackFired) {
        status("❌ Recording finalize timed out (permission denied / no audio). Try again.");
        try { recorder.stop(); } catch (e) {}
        cleanupLiveStream();
        try { recorder.setInput(masterGain); } catch (e) {}
        isRecording = false;
      }
    }, 10000);

  } catch (e) {
    console.error(e);

    if (recordFinalizeTimer) {
      clearTimeout(recordFinalizeTimer);
      recordFinalizeTimer = null;
    }

    if (e && e.name === "NotAllowedError") {
      status("❌ Permission denied. Allow microphone/tab-audio in browser site settings.");
    } else {
      status("❌ Recording failed: " + (e?.message || e));
    }

    cleanupLiveStream();
    try { recorder.setInput(masterGain); } catch (err) {}
    isRecording = false;
  }
}

function describeStream(stream) {
  // Debug helper: prints out audio/video track details so permission/track issues are easier to spot.
  const a = stream.getAudioTracks();
  const v = stream.getVideoTracks();
  console.log("Audio tracks:", a.length, a.map(t => ({label: t.label, enabled: t.enabled, muted: t.muted, readyState: t.readyState})));
  console.log("Video tracks:", v.length, v.map(t => ({label: t.label, enabled: t.enabled, muted: t.muted, readyState: t.readyState})));
}

function stopRecord() {
  // Stop triggers the finalize callback inside recorder.record(...).
  if (!isRecording) return;

  status("Finalizing recording...");
  try { recorder.stop(); } catch (e) {}

  isRecording = false;

  // I don’t kill the stream here; the finalize callback cleans up after saving.
  // If finalize gets stuck, the timeout in startRecord() handles it.
}

function cleanupLiveStream() {
  // Stop all tracks so the browser releases the capture/mic.
  if (liveStream) {
    try { liveStream.getTracks().forEach(t => t.stop()); } catch (e) {}
    liveStream = null;
  }
  liveNode = null;
}

async function findFirstAvailableSlot() {
  // Simple slot policy: fill the first empty slot. If all are taken, overwrite sound1.
  const order = ["sound1","sound2","sound3","sound4","sound5","sound6"];
  for (const s of order) {
    const rec = await dbGet(s);
    if (!rec || !rec.blob) return s;
  }
  // If all are taken, default overwrite sound1 (simple + predictable)
  return "sound1";
}
