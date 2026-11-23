#!/usr/bin/env python3
"""Membuat SKILL.md satu berkas (skrip pasang_hook.py ditanam di dalamnya) untuk disimpan langsung sebagai
skill di claude.ai tanpa zip: python3 tools/make_skill_single.py  ->  dist/skill-satu-berkas/SKILL.md"""
import os, re, sys

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = os.path.join(root, ".claude", "skills", "hubungkan-dragon-island")
md = open(os.path.join(src, "SKILL.md"), encoding="utf-8").read()
script = open(os.path.join(src, "scripts", "pasang_hook.py"), encoding="utf-8").read()
assert "```" not in script, "skrip tidak boleh memuat pagar kode"

TMP = "/tmp/pasang_hook.py"
md = md.replace("dari folder skill ini:\n   `python3 scripts/pasang_hook.py`", f"`python3 {TMP}`")
md = md.replace("python3 scripts/pasang_hook.py", f"python3 {TMP}")
assert "scripts/pasang_hook.py" not in md.replace("`scripts/pasang_hook.py`", ""), "masih ada rujukan ke folder skill"

intro = f"""
## Skrip

Skill ini satu berkas. Sebelum langkah di bawah, tulis skrip berikut ke `{TMP}` **persis seperti ini, tanpa
diubah** (mis. dengan heredoc `cat > {TMP} <<'PY' ... PY`), lalu jalankan seperti di langkah.

```python
{script.rstrip()}
```
"""
# sisipkan setelah paragraf pembuka (sebelum "## Langkah")
assert "\n## Langkah" in md
md = md.replace("\n## Langkah", intro + "\n## Langkah", 1)
md = md.replace("`scripts/pasang_hook.py` (repo dragon-d-island)", "`scripts/cloud-setup-script.sh` (repo dragon-d-island)")

out = os.path.join(root, "dist", "skill-satu-berkas")
os.makedirs(out, exist_ok=True)
open(os.path.join(out, "SKILL.md"), "w", encoding="utf-8").write(md)
print(os.path.join(out, "SKILL.md"), len(md), "byte")
