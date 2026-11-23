#!/usr/bin/env python3
"""Menghubungkan sesi Claude Code (cloud) ke Dragon Dynamic Island di laptop.

Memasang hook bertipe command + curl ke ~/.claude/settings.json untuk 8 event sesi, lalu memeriksa
apakah laptop terjangkau. Memakai curl, bukan hook bertipe http: di VM cloud, http hook tidak lewat
proxy jaringan dan menimbulkan "hook error".

Mode token:
  (tanpa --token)  hook membaca variabel environment DRAGON_ISLAND_TOKEN saat berjalan; tidak ada
                   rahasia yang ditulis ke berkas. Perlu variabel itu ada di environment cloud.
  --token <TOKEN>  token ditulis langsung ke settings.json sesi ini (untuk sesi yang sudah berjalan
                   dan tidak punya variabel itu). Token cloud hanya bisa mengirim kabar sesi.
Token tidak pernah dicetak.

  python3 pasang_hook.py [--url https://nama-laptop.tailnet.ts.net] [--token TOKEN] [--settings PATH]
  python3 pasang_hook.py --cek      # hanya memeriksa koneksi, tanpa mengubah apa pun
"""
import argparse, json, os, subprocess, sys

DEFAULT_URL = os.environ.get("DRAGON_ISLAND_URL", "https://dlegiongo.taile2fcaa.ts.net")
EVENTS = ["SessionStart", "UserPromptSubmit", "PostToolUse", "PermissionRequest", "Notification", "Stop", "StopFailure", "SessionEnd"]


def hook_command(url, token):
    hdr = token if token else "$DRAGON_ISLAND_TOKEN"
    guard = "" if token else '[ -n "$DRAGON_ISLAND_TOKEN" ] && '
    return (guard + "curl -sS -m 8 -o /dev/null -X POST " + url + "/dragon-island/hook"
            ' -H "Content-Type: application/json" -H "X-Dragon-Island: ' + hdr + '"'
            ' -H "X-Dragon-Cloud-Session: $CLAUDE_CODE_REMOTE_SESSION_ID" --data-binary @-; true')


def is_ours(x):
    return "/dragon-island/" in str(x.get("url", "")) + str(x.get("command", ""))


def install(settings_path, url, token):
    os.makedirs(os.path.dirname(settings_path), exist_ok=True)
    try:
        with open(settings_path) as f:
            cfg = json.load(f)
        if not isinstance(cfg, dict):
            raise ValueError("bukan objek")
    except FileNotFoundError:
        cfg = {}
    except Exception as e:  # berkas ada tapi rusak: jangan ditimpa
        sys.exit(f"settings.json tidak bisa dibaca ({e}). Tidak ada yang diubah.")
    h = {"type": "command", "command": hook_command(url, token), "async": True, "timeout": 10}
    hooks = cfg.setdefault("hooks", {})
    for e in EVENTS:
        keep = [g for g in hooks.get(e, []) if not any(is_ours(x) for x in g.get("hooks", []))]
        hooks[e] = keep + [{"hooks": [h]}]
    tmp = settings_path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(cfg, f, indent=2)
    os.replace(tmp, settings_path)


def check(url, token):
    """POST kosong dengan token: 204 = laptop terjangkau dan token benar; 403 = token salah."""
    if not token:
        return "tanpa-token", "Variabel DRAGON_ISLAND_TOKEN tidak ada di sesi ini, jadi koneksi tidak bisa diperiksa."
    try:
        r = subprocess.run(["curl", "-sS", "-m", "10", "-o", "/dev/null", "-w", "%{http_code}", "-X", "POST",
                            url + "/dragon-island/hook", "-H", "Content-Type: application/json",
                            "-H", "X-Dragon-Island: " + token, "--data-binary", "{}"],
                           capture_output=True, text=True, timeout=15)
    except Exception as e:
        return "gagal", f"curl tidak bisa dijalankan: {e}"
    code = r.stdout.strip()
    if code == "204":
        return "ok", "Laptop terjangkau dan token cloud benar."
    if code == "403":
        return "token", "Laptop terjangkau, tapi token ditolak: salin ulang Token cloud dari panel Cloud di pulau."
    if code in ("000", ""):
        return "jaringan", "Laptop tidak terjangkau: pastikan Dragon Dynamic Island berjalan dan Tailscale Funnel menyala " \
                           "(tailscale funnel --bg --set-path /dragon-island 47723)."
    return "lain", f"Balasan tak terduga dari laptop (HTTP {code}); periksa alamat Funnel."


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--token", default="")
    ap.add_argument("--settings", default=os.path.expanduser("~/.claude/settings.json"))
    ap.add_argument("--cek", action="store_true", help="hanya periksa koneksi")
    a = ap.parse_args()
    url = a.url.rstrip("/")
    if not (url.startswith("https://") or url.startswith("http://127.0.0.1") or url.startswith("http://localhost")):
        sys.exit("Alamat harus berbentuk https://nama-host (alamat Funnel).")
    token = a.token or os.environ.get("DRAGON_ISLAND_TOKEN", "")
    if not a.cek:
        install(a.settings, url, a.token)
        print(f"Hook terpasang di {a.settings} ({'token tertulis di berkas' if a.token else 'token dari variabel environment'}).")
        print("Hook aktif untuk pesan berikutnya; sesi muncul di pulau setelah satu pesan lagi.")
    status, msg = check(url, token)
    print(f"Pemeriksaan koneksi: {status}. {msg}")
    sys.exit(0 if status in ("ok", "tanpa-token") else 1)


if __name__ == "__main__":
    main()
