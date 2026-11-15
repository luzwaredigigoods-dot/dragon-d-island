'use strict';
// Suara notifikasi, disintesis dengan Web Audio (tanpa berkas audio).
//   naga    : naga kecil — suara berbeda untuk butuh izin, selesai, dan error (berkas di renderer/sounds)
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

  // Naga kecil: suara berbeda per jenis kabar (dibuat dengan tools/cute.py).
  //   izin    : naga bayi belajar mengaum (paling menarik perhatian)
  //   selesai : tiga cicitan riang
  //   error   : bersin api
  const NAGA_FILES = { permission: ['sounds/naga-izin.mp3', 1.2], done: ['sounds/naga-selesai.mp3', 0.75], error: ['sounds/naga-error.mp3', 1.05] };
  function naga(volume = 0.9, event = 'permission') {
    const [src, dur] = NAGA_FILES[event] || NAGA_FILES.permission;
    const a = new Audio(src);
    a.volume = volume;
    a.play().catch(() => {});
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
  // event: 'permission' | 'done' | 'error' (hanya membedakan suara naga).
  function play(kind, event) {
    try {
      if (kind === 'naga') return naga(0.9, event);
      const f = SOUNDS[kind];
      return f ? f() : 0;
    } catch (_) { return 0; } // audio tidak tersedia
  }
  root.DragonSound = { play, kinds: Object.keys(SOUNDS) };
})(window);
