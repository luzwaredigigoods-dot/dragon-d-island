'use strict';
// Server Claude API tiruan untuk tes: menjawab POST /v1/messages dengan stream SSE,
// atau dengan error bila `opts.status` diisi. Setiap permintaan dicatat di `calls`.
const http = require('http');
function start(reply = 'Halo! Ini jawaban tiruan dari Claude.', opts = {}) {
  const calls = [];
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      const body = JSON.parse(b || '{}'); calls.push({ url: req.url, headers: req.headers, body });
      if (opts.status) { res.writeHead(opts.status, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } })); }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const ev = (t, d) => res.write(`event: ${t}\ndata: ${JSON.stringify({ type: t, ...d })}\n\n`);
      ev('message_start', { message: { id: 'msg_1', type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, usage: { input_tokens: 120, output_tokens: 0 } } });
      ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
      const parts = reply.match(/.{1,6}/gs);
      let i = 0;
      const tick = () => {
        if (i < parts.length) { ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: parts[i++] } }); setTimeout(tick, opts.slow || 40); return; }
        ev('content_block_stop', { index: 0 });
        ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 40 } });
        ev('message_stop', {});
        res.end();
      };
      tick();
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ url: `http://127.0.0.1:${srv.address().port}`, calls, close: () => srv.close() })));
}
module.exports = { start };
