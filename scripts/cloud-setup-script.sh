# Dragon Dynamic Island: kirim kabar sesi cloud ke laptop. Hook command + curl (curl lewat proxy jaringan cloud;
# hook bertipe http tidak). Token dari variabel environment DRAGON_ISLAND_TOKEN; tanpa token, hook diam.
python3 - <<'PY'
import json, os
URL = "https://dlegiongo.taile2fcaa.ts.net/dragon-island/hook"
p = os.path.expanduser("~/.claude/settings.json")
os.makedirs(os.path.dirname(p), exist_ok=True)
try:
    cfg = json.load(open(p))
except Exception:
    cfg = {}
cmd = ('[ -n "$DRAGON_ISLAND_TOKEN" ] && curl -sS -m 8 -o /dev/null -X POST ' + URL +
       ' -H "Content-Type: application/json" -H "X-Dragon-Island: $DRAGON_ISLAND_TOKEN"'
       ' -H "X-Dragon-Cloud-Session: $CLAUDE_CODE_REMOTE_SESSION_ID" --data-binary @-; true')
h = {"type": "command", "command": cmd, "async": True, "timeout": 10}
ours = lambda x: "/dragon-island/" in str(x.get("url", "")) + str(x.get("command", ""))
hooks = cfg.setdefault("hooks", {})
for e in ["SessionStart", "UserPromptSubmit", "PostToolUse", "PermissionRequest", "Notification", "Stop", "StopFailure", "SessionEnd"]:
    keep = [g for g in hooks.get(e, []) if not any(ours(x) for x in g.get("hooks", []))]
    hooks[e] = keep + [{"hooks": [h]}]
json.dump(cfg, open(p, "w"), indent=2)
print("Dragon Dynamic Island: hooks terpasang di", p)
PY
