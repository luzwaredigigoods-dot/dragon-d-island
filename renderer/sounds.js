'use strict';
// Suara notifikasi, disintesis dengan Web Audio (tanpa berkas audio).
//   naga    : auman naga — geraman rendah yang naik lalu turun, dengan desis napas
//   dering  : dering dua nada seperti telepon
//   lonceng : tiga nada lonceng lembut
// Setiap fungsi mengembalikan lama bunyinya (detik).
(function (root) {
  let ctx = null;
  function audio() {
    if (!ctx || ctx.state === 'closed') ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function noiseBuffer(c, seconds) {
    const b = c.createBuffer(1, Math.floor(c.sampleRate * seconds), c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  // Distorsi lembut untuk tekstur "kasar" pada geraman.
  function shaper(c, amount) {
    const s = c.createWaveShaper();
    const n = 1024, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x)); }
    s.curve = curve;
    return s;
  }

  function naga(volume = 0.5) {
    const c = audio(), t = c.currentTime, dur = 1.9;
    const out = c.createGain(); out.gain.value = volume; out.connect(c.destination);
    // badan suara: dua gelombang gergaji sedikit berbeda nada, naik lalu turun
    const body = c.createGain();
    body.gain.setValueAtTime(0.0001, t);
    body.gain.exponentialRampToValueAtTime(0.9, t + 0.25);
    body.gain.setValueAtTime(0.9, t + 0.9);
    body.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 6;
    lp.frequency.setValueAtTime(260, t);
    lp.frequency.exponentialRampToValueAtTime(1500, t + 0.45);
    lp.frequency.exponentialRampToValueAtTime(320, t + dur);
    const dist = shaper(c, 18);
    for (const detune of [0, 17]) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.detune.value = detune;
      o.frequency.setValueAtTime(68, t);
      o.frequency.exponentialRampToValueAtTime(150, t + 0.4);
      o.frequency.exponentialRampToValueAtTime(52, t + dur);
      // getaran tenggorokan
      const lfo = c.createOscillator(), lfoGain = c.createGain();
      lfo.frequency.value = 24; lfoGain.gain.value = 9;
      lfo.connect(lfoGain).connect(o.frequency);
      o.connect(dist); lfo.start(t); o.start(t); lfo.stop(t + dur); o.stop(t + dur);
    }
    dist.connect(lp).connect(body).connect(out);
    // desis napas
    const n = c.createBufferSource(); n.buffer = noiseBuffer(c, dur);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(700, t); bp.frequency.exponentialRampToValueAtTime(2200, t + 0.5); bp.frequency.exponentialRampToValueAtTime(500, t + dur);
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(0.35, t + 0.3); ng.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(bp).connect(ng).connect(out); n.start(t); n.stop(t + dur);
    return dur;
  }

  function dering(volume = 0.35) {
    const c = audio(), t0 = c.currentTime;
    const out = c.createGain(); out.gain.value = volume; out.connect(c.destination);
    // dua kali "kring" (480 + 620 Hz bergantian cepat)
    for (const start of [0, 0.75]) {
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t0 + start);
      g.gain.exponentialRampToValueAtTime(0.6, t0 + start + 0.02);
      g.gain.setValueAtTime(0.6, t0 + start + 0.45);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + start + 0.55);
      g.connect(out);
      for (const f of [480, 620]) {
        const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f;
        const am = c.createGain(); am.gain.value = 0.5;
        const lfo = c.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 20;
        const lg = c.createGain(); lg.gain.value = 0.5;
        lfo.connect(lg).connect(am.gain);
        o.connect(am).connect(g);
        o.start(t0 + start); lfo.start(t0 + start); o.stop(t0 + start + 0.6); lfo.stop(t0 + start + 0.6);
      }
    }
    return 1.4;
  }

  function lonceng(volume = 0.5) {
    const c = audio(), t0 = c.currentTime;
    [[659, 0], [784, 0.22], [988, 0.44]].forEach(([f, s]) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0, t0 + s);
      g.gain.linearRampToValueAtTime(0.36 * volume, t0 + s + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + s + 0.9);
      o.connect(g).connect(c.destination); o.start(t0 + s); o.stop(t0 + s + 1);
    });
    return 1.4;
  }

  const SOUNDS = { naga, dering, lonceng };
  function play(kind) {
    try { const f = SOUNDS[kind]; return f ? f() : 0; } catch (_) { return 0; } // audio tidak tersedia
  }
  root.DragonSound = { play, kinds: Object.keys(SOUNDS) };
})(window);
