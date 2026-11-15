"""Opsi suara naga kecil yang lucu. Memakai mesin sintesis yang sama dengan roar.py."""
import sys
import numpy as np

src = open(__file__.replace('cute.py', 'roar.py')).read()
exec(src.split("out = sys.argv[1]")[0])  # fungsi-fungsi sintesis saja

out = sys.argv[1]

# Formant mulut kecil (lebih tinggi dari manusia dewasa = makhluk mungil)
SMALL_OO = [(520, 1.0, 160), (1100, 0.6, 240), (2700, 0.25, 500)]
SMALL_AA = [(900, 1.0, 240), (1700, 0.8, 320), (3300, 0.35, 600)]
SMALL_EE = [(450, 1.0, 140), (2600, 0.7, 400), (3600, 0.3, 600)]


def voice(dur, f0pts, mouthpts, form=(SMALL_OO, SMALL_AA), **kw):
    base = dict(doubling=0.25, breath=0.18, drive=1.4, sub=0.0, rough=0.15, rough_hz=30, rt=0.35, wet=0.12, lp=9000)
    base.update(kw)
    y = roar(dur, f0pts, mouthpts, form=form, **base)
    return y


def gap(sec):
    return np.zeros(int(sec * SR))


def seq(*parts):
    """Gabungkan potongan; ekor gema tiap potongan ditumpuk ke potongan berikutnya."""
    total = np.zeros(sum(len(p) for p, _ in parts) + SR)
    pos = 0
    for p, step in parts:
        total[pos: pos + len(p)] += p
        pos += int(step * SR)
    end = np.max(np.nonzero(np.abs(total) > 1e-4)) + 1
    return total[:end]


# A. Kicau penasaran: "hm?" dua nada, nada kedua naik seperti bertanya
a1 = voice(0.22, [(0, 300), (1, 340)], [(0, 0.1), (1, 0.4)])
a2 = voice(0.38, [(0, 320), (0.5, 380), (1, 560)], [(0, 0.2), (1, 1)])
finish(seq((a1, 0.27), (a2, 0)), f'{out}/A-kicau-penasaran.wav')

# B. Dengkur senang: dengkur rendah bergetar lalu "kuuu" naik
b1 = voice(0.7, [(0, 140), (1, 150)], [(0, 0), (1, 0.2)], doubling=0.6, rough=0.9, rough_hz=24, breath=0.35, drive=1.8)
b2 = voice(0.45, [(0, 260), (0.6, 420), (1, 380)], [(0, 0.1), (0.6, 0.8), (1, 0.5)])
finish(seq((b1, 0.55), (b2, 0)), f'{out}/B-dengkur-senang.wav')

# C. Belajar mengaum: naga bayi mencoba mengaum, suaranya pecah ke atas lalu batuk kecil
c1 = voice(0.55, [(0, 170), (0.4, 220), (0.6, 520), (1, 480)], [(0, 0.3), (0.3, 1), (1, 0.8)],
           doubling=0.7, rough=0.5, rough_hz=34, breath=0.4, drive=2.4)
c2 = voice(0.09, [(0, 380), (1, 300)], [(0, 0.6), (1, 0.2)], breath=0.9, doubling=0.5)
c3 = voice(0.08, [(0, 360), (1, 290)], [(0, 0.6), (1, 0.2)], breath=0.9, doubling=0.5)
finish(seq((c1, 0.62), (c2, 0.13), (c3, 0)), f'{out}/C-belajar-mengaum.wav')

# D. Kicau riang: tiga cicitan pendek yang makin tinggi
d = [voice(0.12, [(0, f), (1, f * 1.35)], [(0, 0.3), (1, 1)], form=(SMALL_EE, SMALL_AA)) for f in (420, 520, 640)]
finish(seq((d[0], 0.14), (d[1], 0.14), (d[2], 0)), f'{out}/D-kicau-riang.wav')

# E. Bersin api: tarik napas, "hhh-ptchu!" lalu desis api kecil
inhale = voice(0.35, [(0, 300), (1, 420)], [(0, 0.0), (1, 0.6)], breath=2.5, doubling=0.1) * 0.35
sneeze = voice(0.13, [(0, 600), (1, 380)], [(0, 1), (1, 0.2)], breath=1.6, drive=2.2, form=(SMALL_EE, SMALL_AA))
puff = fire(0.45, start_hz=1500, end_hz=4000, crackle=0.5) * 0.4
finish(seq((inhale, 0.42), (sneeze, 0.12), (puff, 0)), f'{out}/E-bersin-api.wav')

# F. Panggilan manja: "mrrr-ip!" getaran lidah lalu cicit naik
f1 = voice(0.32, [(0, 240), (1, 260)], [(0, 0.2), (1, 0.4)], rough=1.0, rough_hz=28, doubling=0.4)
f2 = voice(0.18, [(0, 380), (1, 700)], [(0, 0.4), (1, 1)], form=(SMALL_EE, SMALL_AA))
finish(seq((f1, 0.3), (f2, 0)), f'{out}/F-panggilan-manja.wav')
print('ok')
