let audioCtx = null;

// ---------- Tab ----------
const tabMetronome = document.getElementById("tabMetronome");
const tabTuner = document.getElementById("tabTuner");
const metronomePanel = document.getElementById("metronomePanel");
const tunerPanel = document.getElementById("tunerPanel");

tabMetronome.addEventListener("click", () => switchTab("metronome"));
tabTuner.addEventListener("click", () => switchTab("tuner"));

function switchTab(mode) {
  const isMetronome = mode === "metronome";
  tabMetronome.classList.toggle("active", isMetronome);
  tabTuner.classList.toggle("active", !isMetronome);
  metronomePanel.classList.toggle("hidden", !isMetronome);
  tunerPanel.classList.toggle("hidden", isMetronome);
}

// ---------- Metronome ----------
const bpmRange = document.getElementById("bpmRange");
const bpmNumber = document.getElementById("bpmNumber");
const beatsPerBar = document.getElementById("beatsPerBar");
const volume = document.getElementById("volume");
const toggleMetronomeBtn = document.getElementById("toggleMetronome");
const beatDots = document.getElementById("beatDots");

let isMetronomeRunning = false;
let metronomeTimer = null;
let nextNoteTime = 0;
let currentBeat = 0;
const lookaheadMs = 25;
const scheduleAheadTime = 0.1;

function ensureAudioContext() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();
}

function renderDots() {
  const count = Number(beatsPerBar.value);
  beatDots.innerHTML = "";
  for (let i = 0; i < count; i++) {
    const d = document.createElement("div");
    d.className = "dot" + (i === 0 ? " strong" : "");
    beatDots.appendChild(d);
  }
}
renderDots();

function setActiveDot(index) {
  const dots = [...beatDots.querySelectorAll(".dot")];
  dots.forEach((d, i) => d.classList.toggle("active", i === index));
}

function nextBeatTime() {
  const secondsPerBeat = 60 / Number(bpmNumber.value);
  nextNoteTime += secondsPerBeat;
  currentBeat = (currentBeat + 1) % Number(beatsPerBar.value);
}

function scheduleBeat(beatIndex, time) {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  const isStrong = beatIndex === 0;
  const freq = isStrong ? 1200 : 900;
  const vol = Number(volume.value) * (isStrong ? 1.0 : 0.75);

  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(Math.max(vol, 0.001), time + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.04);

  osc.connect(gain).connect(audioCtx.destination);
  osc.start(time);
  osc.stop(time + 0.05);

  const delay = Math.max(0, (time - audioCtx.currentTime) * 1000);
  setTimeout(() => setActiveDot(beatIndex), delay);
}

function scheduler() {
  while (nextNoteTime < audioCtx.currentTime + scheduleAheadTime) {
    scheduleBeat(currentBeat, nextNoteTime);
    nextBeatTime();
  }
}

function startMetronome() {
  ensureAudioContext();
  isMetronomeRunning = true;
  toggleMetronomeBtn.textContent = "暂停";
  currentBeat = 0;
  nextNoteTime = audioCtx.currentTime + 0.05;
  metronomeTimer = setInterval(scheduler, lookaheadMs);
}

function stopMetronome() {
  isMetronomeRunning = false;
  toggleMetronomeBtn.textContent = "开始";
  clearInterval(metronomeTimer);
  setActiveDot(-1);
}

toggleMetronomeBtn.addEventListener("click", () => {
  if (isMetronomeRunning) stopMetronome();
  else startMetronome();
});

beatsPerBar.addEventListener("change", () => {
  renderDots();
  currentBeat = 0;
});

function syncBpm(v) {
  const n = Math.min(240, Math.max(40, Number(v) || 100));
  bpmRange.value = String(n);
  bpmNumber.value = String(n);
}
bpmRange.addEventListener("input", e => syncBpm(e.target.value));
bpmNumber.addEventListener("input", e => syncBpm(e.target.value));

// ---------- Tuner ----------
const toggleTunerBtn = document.getElementById("toggleTuner");
const noteEl = document.getElementById("note");
const freqEl = document.getElementById("freq");
const centsEl = document.getElementById("cents");
const needleEl = document.getElementById("needle");
const tunerStatus = document.getElementById("tunerStatus");

let tunerRunning = false;
let micStream = null;
let micSource = null;
let analyser = null;
let rafId = null;

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function freqToMidi(freq) {
  return 69 + 12 * Math.log2(freq / 440);
}

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function updateTunerUI(freq) {
  if (!freq || freq <= 0) {
    noteEl.textContent = "--";
    freqEl.textContent = "0.0 Hz";
    centsEl.textContent = "0 cents";
    needleEl.style.left = "50%";
    return;
  }

  const midi = freqToMidi(freq);
  const nearest = Math.round(midi);
  const targetFreq = midiToFreq(nearest);
  const cents = Math.round(1200 * Math.log2(freq / targetFreq));

  const noteName = NOTE_NAMES[nearest % 12];
  const octave = Math.floor(nearest / 12) - 1;

  noteEl.textContent = `${noteName}${octave}`;
  freqEl.textContent = `${freq.toFixed(1)} Hz`;
  centsEl.textContent = `${cents > 0 ? "+" : ""}${cents} cents`;

  const clamped = Math.max(-50, Math.min(50, cents));
  const percent = 50 + clamped;
  needleEl.style.left = `${percent}%`;
}

function autoCorrelate(buffer, sampleRate) {
  let rms = 0;
  for (let i = 0; i < buffer.length; i++) rms += buffer[i] * buffer[i];
  rms = Math.sqrt(rms / buffer.length);
  if (rms < 0.01) return -1;

  let r1 = 0;
  let r2 = buffer.length - 1;
  const threshold = 0.2;

  for (let i = 0; i < buffer.length / 2; i++) {
    if (Math.abs(buffer[i]) < threshold) {
      r1 = i;
      break;
    }
  }

  for (let i = 1; i < buffer.length / 2; i++) {
    if (Math.abs(buffer[buffer.length - i]) < threshold) {
      r2 = buffer.length - i;
      break;
    }
  }

  const trimmed = buffer.slice(r1, r2);
  const c = new Array(trimmed.length).fill(0);

  for (let i = 0; i < trimmed.length; i++) {
    for (let j = 0; j < trimmed.length - i; j++) {
      c[i] += trimmed[j] * trimmed[j + i];
    }
  }

  let d = 0;
  while (d < c.length - 1 && c[d] > c[d + 1]) d++;

  let maxPos = -1;
  let maxVal = -1;
  for (let i = d; i < c.length; i++) {
    if (c[i] > maxVal) {
      maxVal = c[i];
      maxPos = i;
    }
  }

  if (maxPos <= 0) return -1;
  return sampleRate / maxPos;
}

function tunerLoop() {
  const buf = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(buf);
  const pitch = autoCorrelate(buf, audioCtx.sampleRate);

  if (pitch === -1) {
    tunerStatus.textContent = "请持续发一个稳定的音（例如弹一根弦）。";
    updateTunerUI(null);
  } else {
    tunerStatus.textContent = "识别中";
    updateTunerUI(pitch);
  }

  rafId = requestAnimationFrame(tunerLoop);
}

async function startTuner() {
  ensureAudioContext();

  if (isMetronomeRunning) stopMetronome();

  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    });
    micSource = audioCtx.createMediaStreamSource(micStream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    micSource.connect(analyser);

    tunerRunning = true;
    toggleTunerBtn.textContent = "停止调音";
    tunerStatus.textContent = "麦克风已开启，请发音。";
    tunerLoop();
  } catch (err) {
    tunerStatus.textContent = "无法访问麦克风，请检查权限或 HTTPS。";
    console.error(err);
  }
}

function stopTuner() {
  tunerRunning = false;
  toggleTunerBtn.textContent = "启动调音";
  tunerStatus.textContent = "点击“启动调音”并允许麦克风权限。";
  if (rafId) cancelAnimationFrame(rafId);
  if (micStream) micStream.getTracks().forEach(t => t.stop());
  rafId = null;
  micStream = null;
  micSource = null;
  analyser = null;
  updateTunerUI(null);
}

toggleTunerBtn.addEventListener("click", () => {
  if (tunerRunning) stopTuner();
  else startTuner();
});
