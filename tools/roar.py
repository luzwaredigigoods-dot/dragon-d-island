"""Sintesis beberapa opsi auman naga (tanpa rekaman pihak lain).

Teknik: sumber suara 'pita suara' (deret pulsa dengan jitter dan penggandaan periode untuk
geraman kasar) + desah napas, disaring formant mulut yang besar (formant rendah = makhluk besar),
disaturasi, ditambah dengung sub-bass dan gema gua.
"""
import sys
import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 48000
rng = np.random.default_rng(7)


def env_adsr(n, a, r, curve=2.0):
    t = np.linspace(0, 1, n)
    e = np.ones(n)
    na, nr = int(a * n), int(r * n)
    if na: e[:na] = np.linspace(0, 1, na) ** 0.6
    if nr: e[-nr:] = np.linspace(1, 0, nr) ** curve
    return e


def contour(points, n):
    """points: [(t_rel, value)] -> kurva halus panjang n."""
    ts, vs = zip(*points)
    x = np.linspace(0, 1, n)
    y = np.interp(x, ts, vs)
    b, a = signal.butter(2, 8 / (SR / 2))
    return signal.filtfilt(b, a, y)


def glottal(f0, doubling=0.5, jitter=0.02, shimmer=0.15):
    n = len(f0)
    # jitter: penyimpangan nada acak yang lambat
    jit = signal.filtfilt(*signal.butter(2, 30 / (SR / 2)), rng.standard_normal(n)) * jitter * 12
    f = f0 * (1 + jit)
    ph = np.cumsum(f) / SR
    frac = ph % 1.0
    # pulsa glotal: buka pelan, tutup cepat
    pulse = np.where(frac < 0.7, np.sin(np.pi * frac / 0.7) ** 2, 0.0)
    pulse = np.diff(pulse, prepend=0) * 40
    # penggandaan periode (vocal fry / geraman): periode ganjil-genap beda kekuatan
    cyc = np.floor(ph).astype(int)
    alt = np.where(cyc % 2 == 0, 1.0, 1.0 - doubling)
    # shimmer: amplitud tiap periode acak
    sh = 1 + shimmer * rng.standard_normal(cyc.max() + 2)
    return pulse * alt * sh[cyc]


def formants(x, sets, mix):
    """sets: dua set formant [(freq, gain, bw)], mix: 0..1 kurva perpindahan dari set A ke set B."""
    out = []
    for fs in sets:
        y = np.zeros_like(x)
        for f, g, bw in fs:
            lo, hi = max(20, f - bw / 2), min(SR / 2 - 100, f + bw / 2)
            sos = signal.butter(2, [lo, hi], btype='band', fs=SR, output='sos')
            y += g * signal.sosfilt(sos, x)
        out.append(y)
    return out[0] * (1 - mix) + out[1] * mix


def reverb(x, rt=1.2, wet=0.3, tone=3000):
    n = int(rt * SR)
    t = np.arange(n) / SR
    ir = rng.standard_normal(n) * np.exp(-6.9 * t / rt)
    ir = signal.sosfilt(signal.butter(2, tone, fs=SR, output='sos'), ir)
    ir[: int(0.02 * SR)] *= np.linspace(0, 1, int(0.02 * SR))
    ir /= np.sqrt(np.sum(ir ** 2))
    y = np.zeros(len(x) + n); c = signal.fftconvolve(x, ir); y[: min(len(c), len(y))] = c[: len(y)]
    dry = np.concatenate([x, np.zeros(n)])
    return dry * (1 - wet) + y * wet * 1.6


def lowpass(x, f):
    return signal.sosfilt(signal.butter(2, f, fs=SR, output='sos'), x)


def highpass(x, f):
    return signal.sosfilt(signal.butter(2, f, fs=SR, output='sos', btype='high'), x)


BIG_AA = [(380, 1.0, 140), (720, 0.8, 200), (1350, 0.45, 260), (2300, 0.2, 400), (3400, 0.08, 600)]
BIG_OO = [(240, 1.0, 90), (480, 0.6, 130), (1100, 0.25, 220), (2200, 0.08, 400)]


def roar(dur, f0pts, mouth_pts, doubling=0.55, breath=0.35, drive=2.5, sub=0.35, form=(BIG_OO, BIG_AA),
         rough_hz=38, rough=0.35, rt=1.4, wet=0.3, lp=5000):
    n = int(dur * SR)
    f0 = contour(f0pts, n)
    mouth = np.clip(contour(mouth_pts, n), 0, 1)
    src = glottal(f0, doubling=doubling)
    # kekasaran: modulasi amplitudo cepat tak beraturan
    rmod = 1 + rough * np.sin(2 * np.pi * np.cumsum(rough_hz * (1 + 0.3 * rng.standard_normal(n).cumsum() / np.sqrt(n))) / SR)
    src *= rmod
    # napas: derau yang ikut berdenyut dengan pulsa + derau bebas
    noise = rng.standard_normal(n)
    asp = noise * (0.4 + np.abs(src) / (np.abs(src).max() + 1e-9)) * breath
    x = src / (np.abs(src).max() + 1e-9) + asp
    y = formants(x, form, mouth)
    e = env_adsr(n, 0.12, 0.4) * (0.55 + 0.45 * mouth)
    y = y * e
    y = np.tanh(drive * y / (np.abs(y).max() + 1e-9))
    # dengung dada: sub-oktaf
    ph = np.cumsum(f0 / 2) / SR
    y += sub * np.sin(2 * np.pi * ph) * e * (0.6 + 0.4 * np.sin(2 * np.pi * ph * 2) ** 2)
    y = lowpass(highpass(y, 35), lp)
    return reverb(y, rt=rt, wet=wet)


def fire(dur, start_hz=300, end_hz=2500, crackle=0.25):
    n = int(dur * SR)
    noise = rng.standard_normal(n)
    out = np.zeros(n)
    hop = 1024
    fc = np.geomspace(start_hz, end_hz, n // hop + 1)
    for i in range(0, n, hop):
        seg = noise[max(0, i - 2048): i + hop]
        sos = signal.butter(2, [fc[i // hop] * 0.5, min(SR / 2 - 100, fc[i // hop] * 1.8)], btype='band', fs=SR, output='sos')
        out[i: i + hop] = signal.sosfilt(sos, seg)[-len(out[i: i + hop]):]
    cr = (rng.random(n) < 0.0009) * rng.standard_normal(n) * 6
    cr = highpass(cr, 1500)
    e = env_adsr(n, 0.08, 0.55, 1.5)
    return (out / (np.abs(out).max() + 1e-9) + crackle * cr) * e


def finish(y, name, peak=0.89):
    y = y / (np.abs(y).max() + 1e-9) * peak
    fade = int(0.03 * SR)
    y[-fade:] *= np.linspace(1, 0, fade)
    wavfile.write(name, SR, (y * 32767).astype(np.int16))


out = sys.argv[1]

# 1. Auman Gua: panjang, dalam, bergema
finish(roar(2.4, [(0, 52), (0.18, 88), (0.5, 96), (0.8, 74), (1, 50)], [(0, 0.1), (0.2, 0.9), (0.7, 1), (1, 0.3)],
            doubling=0.6, breath=0.35, drive=3, rt=1.8, wet=0.35), f'{out}/1-auman-gua.wav')

# 2. Geraman Pendek: rendah, kasar, mulut setengah tertutup; cocok untuk notifikasi
finish(roar(1.15, [(0, 46), (0.3, 60), (1, 42)], [(0, 0.0), (0.4, 0.45), (1, 0.15)],
            doubling=0.75, breath=0.45, drive=3.5, rough=0.5, rough_hz=30, rt=0.6, wet=0.15, lp=3500), f'{out}/2-geraman-pendek.wav')

# 3. Pekikan Naga: nada tinggi melengking dilapisi geraman rendah (gaya wyvern)
hi = roar(1.7, [(0, 170), (0.25, 330), (0.6, 300), (1, 190)], [(0, 0.3), (0.3, 1), (1, 0.6)],
          doubling=0.35, breath=0.6, drive=2.2, sub=0.0, rough=0.25, rough_hz=55,
          form=([(500, 1, 160), (1100, 0.7, 260), (2600, 0.45, 500), (3800, 0.2, 700)],
                [(800, 1, 220), (1500, 0.9, 320), (2900, 0.6, 600), (4200, 0.25, 800)]), rt=1.4, wet=0.3, lp=7000)
lo = roar(1.7, [(0, 55), (0.3, 80), (1, 50)], [(0, 0.2), (0.3, 0.8), (1, 0.3)], doubling=0.7, rt=1.4, wet=0.3)
finish(hi * 0.65 + lo * 0.6, f'{out}/3-pekikan-naga.wav')

# 4. Auman + Semburan Api
r = roar(1.3, [(0, 55), (0.25, 92), (1, 70)], [(0, 0.2), (0.25, 1), (1, 0.8)], doubling=0.6, drive=3, rt=1.2, wet=0.25)
f = fire(1.6)
total = np.zeros(int(0.75 * SR) + len(f) + int(1.2 * SR))
total[: len(r)] += r
total[int(0.75 * SR): int(0.75 * SR) + len(f)] += reverb(f, rt=1.2, wet=0.25)[: len(f)] * 0.55
finish(total[: int(2.9 * SR)], f'{out}/4-auman-semburan-api.wav')

# 5. Naga Kecil: kicau-dengkur lucu, pendek
finish(roar(0.9, [(0, 230), (0.35, 420), (0.7, 360), (1, 280)], [(0, 0.3), (0.4, 1), (1, 0.4)],
            doubling=0.4, breath=0.25, drive=1.8, sub=0.0, rough=0.7, rough_hz=26,
            form=([(600, 1, 180), (1300, 0.6, 260), (2800, 0.3, 500)], [(900, 1, 240), (1700, 0.7, 320), (3200, 0.35, 600)]),
            rt=0.5, wet=0.15, lp=8000), f'{out}/5-naga-kecil.wav')
print('ok')
