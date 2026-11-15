'use strict';
// Perhitungan waktu sholat secara lokal (tanpa internet).
// Kriteria Kemenag RI: Subuh 20°, Isya 18°, Ashar mazhab Syafi'i, ihtiyat +2 menit.
(function (root) {
  const R = Math.PI / 180;
  const sin = (d) => Math.sin(d * R), cos = (d) => Math.cos(d * R), tan = (d) => Math.tan(d * R);
  const asin = (x) => Math.asin(x) / R, acos = (x) => Math.acos(x) / R;
  const atan2 = (y, x) => Math.atan2(y, x) / R, acot = (x) => Math.atan(1 / x) / R;
  const fix = (a, n) => a - n * Math.floor(a / n);

  function julian(y, m, d) {
    if (m <= 2) { y -= 1; m += 12; }
    const A = Math.floor(y / 100), B = 2 - A + Math.floor(A / 4);
    return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + B - 1524.5;
  }
  function sun(jd) {
    const D = jd - 2451545.0;
    const g = fix(357.529 + 0.98560028 * D, 360);
    const q = fix(280.459 + 0.98564736 * D, 360);
    const L = fix(q + 1.915 * sin(g) + 0.020 * sin(2 * g), 360);
    const e = 23.439 - 0.00000036 * D;
    const ra = atan2(cos(e) * sin(L), cos(L)) / 15;
    return { decl: asin(sin(e) * sin(L)), eqt: q / 15 - fix(ra, 24) };
  }

  // Mengembalikan menit sejak tengah malam (waktu lokal) untuk tiap waktu.
  function compute(date, lat, lng, tzHours, adjustMin) {
    const jd = julian(date.getFullYear(), date.getMonth() + 1, date.getDate()) - lng / (15 * 24);
    const noon = (t) => fix(12 - sun(jd + t).eqt, 24);
    const angle = (a, t, before) => {
      const d = sun(jd + t).decl;
      const x = (-sin(a) - sin(d) * sin(lat)) / (cos(d) * cos(lat));
      const dt = acos(Math.max(-1, Math.min(1, x))) / 15;
      return noon(t) + (before ? -dt : dt);
    };
    const asr = (t) => {
      const d = sun(jd + t).decl;
      return angle(-acot(1 + tan(Math.abs(lat - d))), t, false);
    };
    const raw = {
      subuh: angle(20, 5 / 24, true),
      terbit: angle(0.833, 6 / 24, true),
      dzuhur: noon(12 / 24),
      ashar: asr(13 / 24),
      maghrib: angle(0.833, 18 / 24, false),
      isya: angle(18, 18 / 24, false),
    };
    const out = {};
    for (const k of Object.keys(raw)) {
      const local = fix(raw[k] + tzHours - lng / 15, 24) * 60;
      // Terbit dimundurkan (hati-hati), waktu sholat dimajukan 2 menit lalu dibulatkan ke atas.
      out[k] = k === 'terbit' ? Math.floor(local - 2) : Math.ceil(local + 2) + (adjustMin || 0);
    }
    return out;
  }

  const CITIES = [
    ['Tasikmalaya', -7.3274, 108.2207], ['Jakarta', -6.2088, 106.8456], ['Bandung', -6.9175, 107.6191],
    ['Bogor', -6.5971, 106.806], ['Cirebon', -6.732, 108.5523], ['Garut', -7.2279, 107.9087],
    ['Semarang', -6.9667, 110.4167], ['Yogyakarta', -7.7956, 110.3695], ['Surakarta', -7.5755, 110.8243],
    ['Surabaya', -7.2575, 112.7521], ['Malang', -7.9666, 112.6326], ['Denpasar', -8.6705, 115.2126],
    ['Medan', 3.5952, 98.6722], ['Padang', -0.9471, 100.4172], ['Pekanbaru', 0.5071, 101.4478],
    ['Palembang', -2.9761, 104.7754], ['Banda Aceh', 5.5483, 95.3238], ['Pontianak', -0.0263, 109.3425],
    ['Banjarmasin', -3.3186, 114.5944], ['Balikpapan', -1.2379, 116.8529], ['Makassar', -5.1477, 119.4327],
    ['Manado', 1.4748, 124.8421], ['Jayapura', -2.5916, 140.669],
  ];

  root.Prayer = { compute, CITIES };
  if (typeof module !== 'undefined') module.exports = root.Prayer;
})(typeof window !== 'undefined' ? window : globalThis);
