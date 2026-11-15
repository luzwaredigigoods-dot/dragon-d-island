'use strict';
// Chat cepat dengan Claude lewat Claude API (proses utama).
// Kunci API disimpan terenkripsi oleh Windows (Electron safeStorage / DPAPI), tidak pernah dikirim ke tampilan.
const fs = require('fs');
const path = require('path');
const { Anthropic } = require('@anthropic-ai/sdk');

const MODELS = {
  'claude-opus-5-5': { label: 'Opus 5.5', input: 4, output: 20, fallbacks: true },
  'claude-sonnet-5-5': { label: 'Sonnet 5.5', input: 2, output: 10, fallbacks: true },
  'claude-haiku-5-5': { label: 'Haiku 5.5', input: 0.1, output: 0.5, fallbacks: false },
};
const DEFAULT_MODEL = 'claude-opus-5-5';
const SYSTEM = [
  'Kamu asisten cepat di dalam widget kecil di layar desktop pengguna.',
  'Jawab ringkas dan langsung ke inti, dalam bahasa yang dipakai pengguna (biasanya Bahasa Indonesia).',
  'Pakai teks biasa; daftar pendek boleh, hindari tabel dan judul besar karena ruang tampilnya sempit.',
].join(' ');

function createChat({ safeStorage, userDataDir, log, send }) {
  const keyFile = path.join(userDataDir, 'claude-key.bin');
  const usageFile = path.join(userDataDir, 'claude-chat-usage.json');
  let memoryKey = ''; // dipakai bila enkripsi Windows tidak tersedia: tidak disimpan ke disk
  let history = [];   // percakapan berjalan (Anthropic.Beta.BetaMessageParam[])
  let current = null; // stream yang sedang berjalan

  const encryptionOk = () => { try { return safeStorage.isEncryptionAvailable(); } catch (_) { return false; } };

  function readKey() {
    if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
    if (memoryKey) return memoryKey;
    try {
      if (fs.existsSync(keyFile) && encryptionOk()) return safeStorage.decryptString(fs.readFileSync(keyFile));
    } catch (err) { log('kunci Claude tidak terbaca:', String(err).slice(0, 120)); }
    return '';
  }

  function setKey(key) {
    key = String(key || '').trim();
    if (!key) {
      memoryKey = '';
      try { fs.rmSync(keyFile, { force: true }); } catch (_) { /* tidak ada */ }
      log('kunci Claude dihapus');
      return { ok: true, stored: 'none' };
    }
    if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key)) return { ok: false, error: 'Format kunci tidak dikenal (harus diawali sk-ant-)' };
    if (encryptionOk()) {
      fs.writeFileSync(keyFile, safeStorage.encryptString(key));
      memoryKey = '';
      log('kunci Claude disimpan (terenkripsi)');
      return { ok: true, stored: 'encrypted' };
    }
    memoryKey = key;
    log('kunci Claude disimpan di memori saja (enkripsi tidak tersedia)');
    return { ok: true, stored: 'memory' };
  }

  // Usage chat: token dan perkiraan biaya per hari (tarif API Anthropic).
  function loadUsage() {
    try { return JSON.parse(fs.readFileSync(usageFile, 'utf8')); } catch (_) { return { days: {} }; }
  }
  function addUsage(model, usage) {
    const u = loadUsage();
    const day = new Date().toISOString().slice(0, 10);
    const d = u.days[day] || (u.days[day] = { input: 0, output: 0, cost: 0, requests: 0 });
    const price = MODELS[model] || MODELS[DEFAULT_MODEL];
    const input = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) * 1.25 + (usage.cache_read_input_tokens || 0) * 0.1;
    d.input += (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0);
    d.output += usage.output_tokens || 0;
    d.cost += (input * price.input + (usage.output_tokens || 0) * price.output) / 1e6;
    d.requests += 1;
    for (const k of Object.keys(u.days).sort().slice(0, -31)) delete u.days[k]; // simpan 31 hari terakhir
    try { fs.writeFileSync(usageFile, JSON.stringify(u)); } catch (_) { /* abaikan */ }
    return usageSummary();
  }
  function usageSummary() {
    const u = loadUsage();
    const today = new Date().toISOString().slice(0, 10);
    const month = today.slice(0, 7);
    const sum = (filter) => Object.entries(u.days).filter(([k]) => filter(k)).reduce((a, [, v]) => ({
      input: a.input + v.input, output: a.output + v.output, cost: a.cost + v.cost, requests: a.requests + v.requests,
    }), { input: 0, output: 0, cost: 0, requests: 0 });
    return { today: sum((k) => k === today), month: sum((k) => k.startsWith(month)) };
  }

  function status() {
    return {
      hasKey: !!readKey(),
      fromEnv: !!process.env.ANTHROPIC_API_KEY,
      encryption: encryptionOk(),
      models: Object.entries(MODELS).map(([id, m]) => ({ id, label: m.label })),
      usage: usageSummary(),
    };
  }

  function reset() {
    if (current) { try { current.abort(); } catch (_) { /* sudah selesai */ } current = null; }
    history = [];
  }

  async function ask(text, model) {
    text = String(text || '').trim();
    if (!text) return { ok: false, error: 'Pesan kosong' };
    const key = readKey();
    if (!key) return { ok: false, error: 'Belum ada kunci API Claude' };
    if (current) return { ok: false, error: 'Masih menjawab pesan sebelumnya' };
    model = MODELS[model] ? model : DEFAULT_MODEL;

    const client = new Anthropic({ apiKey: key, maxRetries: 2 });
    history.push({ role: 'user', content: text });
    const params = {
      model,
      max_tokens: 64000,
      system: SYSTEM,
      // Chat singkat: effort rendah supaya cepat; Opus 5.5 & Haiku 5.5 tetap berpikir seperlunya.
      output_config: { effort: 'low' },
      messages: history,
    };
    // Bila model menolak karena pengaman, API mengulang otomatis di model cadangan yang sesuai.
    if (MODELS[model].fallbacks) { params.betas = ['server-side-fallback-2026-07-01']; params.fallbacks = 'default'; }

    let streamed = '';
    try {
      current = client.beta.messages.stream(params);
      current.on('text', (delta) => { streamed += delta; send('claude:delta', delta); });
      const message = await current.finalMessage();
      current = null;
      // Simpan seluruh content (termasuk blok thinking) agar percakapan berikutnya utuh.
      history.push({ role: 'assistant', content: message.content });
      const usage = addUsage(model, message.usage || {});
      const reply = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      if (message.stop_reason === 'refusal') {
        log('chat Claude: ditolak', message.stop_details && message.stop_details.category);
        return { ok: true, text: reply, note: 'Claude menolak menjawab permintaan ini.', usage, model: message.model };
      }
      const note = message.stop_reason === 'max_tokens' ? 'Jawaban terpotong (batas panjang).' : '';
      return { ok: true, text: reply || streamed, note, usage, model: message.model };
    } catch (err) {
      current = null;
      history.pop(); // pesan yang gagal tidak masuk riwayat
      let error;
      if (err instanceof Anthropic.AuthenticationError) error = 'Kunci API ditolak. Periksa kunci di pengaturan.';
      else if (err instanceof Anthropic.PermissionDeniedError) error = 'Kunci API tidak punya akses ke model ini.';
      else if (err instanceof Anthropic.RateLimitError) error = 'Terlalu banyak permintaan. Coba lagi sebentar lagi.';
      else if (err instanceof Anthropic.BadRequestError) error = `Permintaan ditolak: ${err.message}`.slice(0, 200);
      else if (err instanceof Anthropic.APIUserAbortError) error = 'Dihentikan.';
      else if (err instanceof Anthropic.APIConnectionError) error = 'Tidak bisa terhubung ke Claude. Periksa internet.';
      else if (err instanceof Anthropic.APIError) error = `Claude error ${err.status || ''}: ${err.message}`.slice(0, 200);
      else error = String(err && err.message || err).slice(0, 200);
      log('chat Claude gagal:', error);
      return { ok: false, error, partial: streamed };
    }
  }

  function stop() { if (current) { try { current.abort(); } catch (_) { /* sudah selesai */ } } }

  return { status, setKey, ask, reset, stop };
}

module.exports = { createChat, MODELS };
