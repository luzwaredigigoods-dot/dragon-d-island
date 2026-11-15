'use strict';
// Jendela polos (tidak transparan) yang berada tepat di bawah pulau. Jendela transparan pulau
// tidak menerima seret-lepas dari Windows, jadi jendela inilah yang menangkap file yang diseret.
(() => {
  const api = window.catchApi;
  let lastOver = 0;
  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    api.enter([...(e.dataTransfer ? e.dataTransfer.types : [])]);
  });
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    const now = Date.now();
    if (now - lastOver > 150) { lastOver = now; api.over(); }
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    const dt = e.dataTransfer;
    const paths = [];
    const notes = [];
    if (dt) {
      for (const file of [...dt.files]) {
        try { const p = api.pathForFile(file); if (p) paths.push(p); } catch (err) { notes.push(`pathForFile: ${err}`); }
      }
      if (!paths.length) { // beberapa sumber hanya memberi teks/URL
        const text = dt.getData('text/uri-list') || dt.getData('text/plain') || '';
        for (const line of text.split(/\r?\n/)) {
          const t = line.trim();
          if (/^file:\/\//i.test(t)) {
            try { paths.push(decodeURIComponent(new URL(t).pathname).replace(/^\/([A-Za-z]:)/, '$1').replace(/\//g, '\\')); } catch (_) { /* bukan URL */ }
          } else if (/^[A-Za-z]:\\/.test(t)) paths.push(t);
        }
      }
      notes.push(`jenis=${[...dt.types].join(',')} file=${dt.files.length}`);
    }
    api.drop(paths, notes.join(' | '));
  });
})();
