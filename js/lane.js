// A small browser version of AetherStar's note lane.
// Two lines of "Twinkle, Twinkle, Little Star" (traditional), shown one line
// at a time with a sweeping playhead. Pitch comes from the visitor's mic
// (YIN pitch detection) or from a demo singer. Scoring follows the game's
// budget in simplified form: 9,000 for notes by length, 1,000 for lines,
// any octave counts, Normal difficulty (within one semitone).
(() => {
  'use strict';
  const root = document.querySelector('[data-lane]');
  if (!root) return;

  const canvas = root.querySelector('[data-lane-canvas]');
  const ctx2d = canvas.getContext('2d');
  const lyricEl = root.querySelector('[data-lane-lyric]');
  const scoreEl = root.querySelector('[data-lane-score]');
  const overlay = root.querySelector('[data-lane-overlay]');
  const msgEl = root.querySelector('[data-lane-msg]');
  const micBtn = root.querySelector('[data-lane-mic]');
  const demoBtn = root.querySelector('[data-lane-demo]');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const COLORS = {
    accent: '#12d0d9',
    note: '#34343f',
    noteGolden: '#4a4636',
    row: 'rgba(255,255,255,0.045)',
    playhead: 'rgba(243,243,245,0.9)',
    trace: '#f3f3f5',
    ink2: '#b4b4bf',
  };

  /* ---------- The chart ---------- */
  const BPM = 100;
  const BEAT = 60 / BPM;
  const LEAD_IN = 4 * BEAT; // count-in
  const melody = [
    // [beat, beats, midi, syllable, line]
    [0, 1, 60, 'Twin', 0], [1, 1, 60, 'kle', 0], [2, 1, 67, 'twin', 0], [3, 1, 67, 'kle', 0],
    [4, 1, 69, 'lit', 0], [5, 1, 69, 'tle', 0], [6, 2, 67, 'star', 0],
    [8, 1, 65, 'How', 1], [9, 1, 65, 'I', 1], [10, 1, 64, 'won', 1], [11, 1, 64, 'der', 1],
    [12, 1, 62, 'what', 1], [13, 1, 62, 'you', 1], [14, 2, 60, 'are', 1],
  ];
  const notes = melody.map(([b, len, midi, syl, line]) => ({
    t: LEAD_IN + b * BEAT,
    d: len * BEAT - 0.09,
    midi, syl, line,
    beat: b, beats: len,
    hits: [], hitTime: 0,
  }));
  const lines = [0, 1].map((i) => {
    const ns = notes.filter((n) => n.line === i);
    return { notes: ns, start: LEAD_IN + i * 8 * BEAT, end: LEAD_IN + (i + 1) * 8 * BEAT, lo: Math.min(...ns.map((n) => n.midi)), hi: Math.max(...ns.map((n) => n.midi)), rated: false };
  });
  const SONG_END = lines[1].end + 0.4;
  const totalLen = notes.reduce((a, n) => a + n.d, 0);
  const NOTE_POOL = 9000;
  const LINE_POOL = 1000;
  const TOL = 1; // Normal: within one semitone

  /* ---------- State ---------- */
  let audio = null; // AudioContext
  let analyser = null;
  let stream = null;
  let buf = null;
  let mode = 'idle'; // idle | mic | demo
  let t0 = 0;
  let raf = 0;
  let trace = []; // [{t, y}] y = folded midi or null
  let score = 0;
  let shownScore = 0;
  let pops = []; // line verdicts {text, t}
  let demoOsc = null;
  let demoGain = null;

  /* ---------- Canvas sizing ---------- */
  let W = 0, H = 0, dpr = 1;
  const resize = () => {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (mode === 'idle') draw(lines[0].start - 0.001);
  };
  new ResizeObserver(resize).observe(canvas);

  /* ---------- Helpers ---------- */
  const fold = (sung, target) => {
    // Same note in any octave: fold the difference into -6..+6 semitones.
    let d = (sung - target) % 12;
    if (d > 6) d -= 12;
    if (d < -6) d += 12;
    return target + d;
  };
  const lineAt = (t) => (t < lines[1].start ? lines[0] : lines[1]);
  const noteAt = (t) => notes.find((n) => t >= n.t && t < n.t + n.d) || null;
  const nearestNote = (t, line) => {
    let best = line.notes[0], bd = Infinity;
    line.notes.forEach((n) => { const d = Math.abs(n.t + n.d / 2 - t); if (d < bd) { bd = d; best = n; } });
    return best;
  };
  const fmt = new Intl.NumberFormat('en-US');

  /* ---------- Pitch detection (YIN) ---------- */
  let yinBuf = null;
  const detectPitch = (data, sr) => {
    let rms = 0;
    for (let i = 0; i < data.length; i++) rms += data[i] * data[i];
    rms = Math.sqrt(rms / data.length);
    if (rms < 0.012) return null;
    const minLag = Math.floor(sr / 1000);
    const maxLag = Math.floor(sr / 75);
    const w = data.length - maxLag;
    if (!yinBuf || yinBuf.length !== maxLag + 1) yinBuf = new Float32Array(maxLag + 1);
    const d = yinBuf;
    d[0] = 1;
    let running = 0;
    for (let tau = 1; tau <= maxLag; tau++) {
      let sum = 0;
      for (let j = 0; j < w; j++) { const x = data[j] - data[j + tau]; sum += x * x; }
      running += sum;
      d[tau] = running ? (sum * tau) / running : 1;
    }
    let tau = -1;
    for (let i = minLag; i < maxLag; i++) {
      if (d[i] < 0.15) { while (i + 1 < maxLag && d[i + 1] < d[i]) i++; tau = i; break; }
    }
    if (tau < 0) return null;
    const a = d[tau - 1], b = d[tau], c = d[tau + 1];
    const shift = (a - c) / (2 * (a - 2 * b + c)) || 0;
    const f = sr / (tau + (Math.abs(shift) < 1 ? shift : 0));
    return 69 + 12 * Math.log2(f / 440);
  };

  /* ---------- Demo singer ---------- */
  // Follows the melody with a small scoop into each note, vibrato on long
  // notes and two slips, so it scores like a decent singer, not a robot.
  const demoPitch = (t) => {
    const n = noteAt(t);
    if (!n) return null;
    const into = t - n.t;
    let p = n.midi + 12; // sings an octave up: any octave counts
    p += -0.9 * Math.exp(-into / 0.06);
    if (n.beats > 1) p += 0.22 * Math.sin(into * 2 * Math.PI * 5.2) * Math.min(1, into / 0.4);
    if (n.syl === 'lit' && into < 0.38) p += 1.9; // reaches for it
    if (n.syl === 'won' && into < 0.3) p -= 1.8; // comes in flat
    if (n.syl === 'what' && into > n.d * 0.45) return null; // runs out of breath
    if (n.syl === 'are' && into > n.d * 0.8) return null;
    return p + Math.sin(t * 7.3) * 0.12;
  };

  /* ---------- Audio ---------- */
  const tick = (when, hi) => {
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.frequency.value = hi ? 1568 : 1046;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.12, when + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.08);
    o.connect(g).connect(audio.destination);
    o.start(when); o.stop(when + 0.1);
  };
  const pluck = (when, midi, len, vol) => {
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.type = 'triangle';
    o.frequency.value = 440 * 2 ** ((midi - 69) / 12);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(vol, when + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, when + Math.min(len, 0.5));
    o.connect(g).connect(audio.destination);
    o.start(when); o.stop(when + len + 0.05);
  };
  const scheduleGuide = (withMelody) => {
    const s = audio.currentTime + 0.1;
    t0 = s;
    for (let i = 0; i < 4; i++) tick(s + i * BEAT, i === 0);
    if (withMelody) notes.forEach((n) => pluck(s + n.t, n.midi, n.d, 0.07));
  };

  /* ---------- Start / stop ---------- */
  const reset = () => {
    notes.forEach((n) => { n.hits = []; n.hitTime = 0; });
    lines.forEach((l) => { l.rated = false; });
    trace = []; score = 0; shownScore = 0; pops = [];
    scoreEl.textContent = '0';
  };

  const begin = async (which) => {
    reset();
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') await audio.resume();
    } catch { msgEl.textContent = 'Your browser blocked audio on this page.'; return; }

    if (which === 'mic') {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        msgEl.textContent = 'This browser can\'t open a microphone here. You can still watch the demo singer.';
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false } });
      } catch {
        msgEl.textContent = 'No microphone access, so nothing to score. You can still watch the demo singer.';
        return;
      }
      const src = audio.createMediaStreamSource(stream);
      analyser = audio.createAnalyser();
      analyser.fftSize = 2048;
      buf = new Float32Array(analyser.fftSize);
      src.connect(analyser);
      scheduleGuide(true);
    } else {
      scheduleGuide(false);
      demoOsc = audio.createOscillator();
      demoGain = audio.createGain();
      demoOsc.type = 'triangle';
      demoGain.gain.value = 0;
      demoOsc.connect(demoGain).connect(audio.destination);
      demoOsc.start();
    }
    mode = which;
    overlay.classList.add('is-hidden');
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
  };

  const finish = () => {
    cancelAnimationFrame(raf);
    if (stream) { stream.getTracks().forEach((tr) => tr.stop()); stream = null; }
    if (demoOsc) { try { demoOsc.stop(); } catch { /* already stopped */ } demoOsc = null; }
    const final = Math.round(score);
    scoreEl.textContent = fmt.format(final);
    const [, rank] = window.aetherRank ? window.aetherRank(final) : [0, ''];
    const was = mode;
    mode = 'idle';
    msgEl.innerHTML = '';
    const big = document.createElement('p');
    big.className = 'lane__result';
    big.textContent = fmt.format(final);
    const sub = document.createElement('span');
    sub.textContent = `${rank}${was === 'demo' ? ', for the demo singer' : ''}. In the game a whole song is worth 10,000 too.`;
    msgEl.append(big, sub);
    micBtn.textContent = was === 'mic' ? 'Sing again' : 'Sing with my microphone';
    demoBtn.textContent = was === 'demo' ? 'Watch it again' : 'Watch a demo singer';
    overlay.classList.remove('is-hidden');
  };

  micBtn.addEventListener('click', () => begin('mic'));
  demoBtn.addEventListener('click', () => begin('demo'));

  /* ---------- Main loop ---------- */
  let lastT = 0;
  const loop = () => {
    const t = audio.currentTime - t0;
    const dt = Math.max(0, Math.min(0.1, t - lastT));
    lastT = t;

    let sung = null;
    if (mode === 'mic' && analyser) {
      analyser.getFloatTimeDomainData(buf);
      sung = detectPitch(buf, audio.sampleRate);
    } else if (mode === 'demo') {
      sung = demoPitch(t);
      if (demoOsc) {
        const now = audio.currentTime;
        if (sung != null) demoOsc.frequency.setTargetAtTime(440 * 2 ** ((sung - 69) / 12), now, 0.01);
        demoGain.gain.setTargetAtTime(sung != null ? 0.09 : 0, now, 0.02);
      }
    }

    const line = lineAt(t);
    const n = noteAt(t);
    if (sung != null && t > lines[0].start - 0.5) {
      const ref = n || nearestNote(t, line);
      const y = fold(sung, ref.midi);
      trace.push({ t, y });
      if (n && Math.abs(Math.round(y) - n.midi) <= TOL) {
        n.hitTime = Math.min(n.d, n.hitTime + dt);
        const last = n.hits[n.hits.length - 1];
        if (last && t - last[1] < 0.06) last[1] = t; else n.hits.push([t - dt, t]);
      }
    } else {
      trace.push({ t, y: null });
    }
    if (trace.length > 2400) trace.splice(0, 600);

    // Score so far: notes by length, then each line's bonus once it ends
    let s = 0;
    notes.forEach((nn) => { s += NOTE_POOL * (nn.d / totalLen) * (nn.hitTime / nn.d); });
    lines.forEach((l) => {
      const max = l.notes.reduce((a, nn) => a + nn.d, 0);
      const got = l.notes.reduce((a, nn) => a + nn.hitTime, 0);
      const frac = got / max;
      if (!l.rated && t >= l.notes[l.notes.length - 1].t + l.notes[l.notes.length - 1].d) {
        l.rated = true;
        l.bonus = (LINE_POOL / lines.length) * frac;
        const label = frac >= 0.95 ? 'Perfect!' : frac >= 0.8 ? 'Great!' : frac >= 0.6 ? 'Good' : frac >= 0.4 ? 'OK' : null;
        if (label) pops.push({ text: label, t });
      }
      if (l.rated) s += l.bonus;
    });
    score = s;
    shownScore += (score - shownScore) * (reduced ? 1 : 0.2);
    scoreEl.textContent = fmt.format(Math.round(shownScore));

    draw(t);
    if (t >= SONG_END) { finish(); return; }
    raf = requestAnimationFrame(loop);
  };

  /* ---------- Drawing ---------- */
  let shownLine = -1;
  const draw = (t) => {
    const line = lineAt(t);
    const li = lines.indexOf(line);
    const padX = Math.max(20, W * 0.04);
    const x = (tt) => padX + ((tt - line.start) / (line.end - line.start)) * (W - padX * 2);
    const lo = line.lo - 3, hi = line.hi + 3;
    const rowH = (H - 24) / (hi - lo + 1);
    const y = (m) => 12 + (hi - m) * rowH + rowH / 2;

    ctx2d.clearRect(0, 0, W, H);

    // Pitch rows as faint tone stripes
    for (let m = lo; m <= hi; m++) {
      if (m % 2 === 0) continue;
      ctx2d.fillStyle = COLORS.row;
      ctx2d.fillRect(0, y(m) - rowH / 2, W, rowH);
    }

    // Notes: bar, then the hit parts in cyan
    const bh = Math.max(10, Math.min(22, rowH * 0.78));
    line.notes.forEach((nn) => {
      const nx = x(nn.t), nw = x(nn.t + nn.d) - nx, ny = y(nn.midi) - bh / 2;
      ctx2d.fillStyle = COLORS.note;
      roundRect(nx, ny, nw, bh, bh / 2); ctx2d.fill();
      ctx2d.save();
      roundRect(nx, ny, nw, bh, bh / 2); ctx2d.clip();
      ctx2d.fillStyle = COLORS.accent;
      nn.hits.forEach(([a, b]) => ctx2d.fillRect(x(a), ny, Math.max(1, x(b) - x(a)), bh));
      ctx2d.restore();
    });

    // The singer's pitch
    ctx2d.lineWidth = 3;
    ctx2d.lineCap = 'round';
    ctx2d.lineJoin = 'round';
    ctx2d.strokeStyle = COLORS.trace;
    ctx2d.beginPath();
    let pen = false;
    for (const p of trace) {
      if (p.t < line.start || p.t > line.end || p.y == null) { pen = false; continue; }
      const px = x(p.t), py = y(p.y);
      if (!pen) { ctx2d.moveTo(px, py); pen = true; } else ctx2d.lineTo(px, py);
    }
    ctx2d.stroke();

    // Playhead
    if (t >= line.start - 0.01) {
      const px = x(Math.min(t, line.end));
      ctx2d.fillStyle = COLORS.playhead;
      ctx2d.fillRect(px - 1, 8, 2, H - 16);
    }

    // Count-in numbers
    if (mode !== 'idle' && t < lines[0].start && t >= 0) {
      const left = Math.ceil((lines[0].start - t) / BEAT);
      ctx2d.fillStyle = COLORS.accent;
      ctx2d.font = `800 ${Math.round(H * 0.32)}px Archivo, sans-serif`;
      ctx2d.textAlign = 'center';
      ctx2d.textBaseline = 'middle';
      ctx2d.fillText(String(left), W / 2, H / 2);
    }

    // Line verdict pops
    pops = pops.filter((p) => t - p.t < 1.6);
    pops.forEach((p) => {
      const age = (t - p.t) / 1.6;
      ctx2d.globalAlpha = 1 - age * age;
      ctx2d.fillStyle = COLORS.accent;
      ctx2d.font = `800 ${Math.round(Math.min(56, H * 0.15))}px Archivo, sans-serif`;
      ctx2d.textAlign = 'right';
      ctx2d.textBaseline = 'top';
      ctx2d.fillText(p.text, W - padX, 14 - (reduced ? 0 : age * 10));
      ctx2d.globalAlpha = 1;
    });

    // Lyrics with per-syllable fill
    if (shownLine !== li) {
      shownLine = li;
      lyricEl.innerHTML = '';
      line.notes.forEach((nn, i) => {
        const s = document.createElement('span');
        s.className = 'w';
        const join = i > 0 && !/^(kle|tle|der)$/.test(nn.syl);
        s.textContent = nn.syl;
        s.dataset.t = nn.syl;
        if (join) lyricEl.append(' ');
        lyricEl.append(s);
      });
    }
    const spans = lyricEl.querySelectorAll('.w');
    line.notes.forEach((nn, i) => {
      const p = Math.max(0, Math.min(1, (t - nn.t) / nn.d));
      spans[i].style.setProperty('--p', `${p * 100}%`);
      spans[i].classList.toggle('is-now', t >= nn.t && t < nn.t + nn.d);
    });
  };

  const roundRect = (rx, ry, rw, rh, r) => {
    ctx2d.beginPath();
    if (ctx2d.roundRect) { ctx2d.roundRect(rx, ry, rw, rh, Math.min(r, rw / 2)); return; }
    ctx2d.rect(rx, ry, rw, rh);
  };

  resize();
})();
