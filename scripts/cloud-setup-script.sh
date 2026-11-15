# Dragon Dynamic Island: kirim kabar sesi cloud ke laptop (hooks http; token dari variabel DRAGON_ISLAND_TOKEN).
python3 - <<'PY'
import json, os
p = os.path.expanduser("~/.claude/settings.json")
os.makedirs(os.path.dirname(p), exist_ok=True)
try:
    cfg = json.load(open(p))
except Exception:
    cfg = {}
h = {"type": "http", "url": "https://dlegiongo.taile2fcaa.ts.net/dragon-island/hook", "timeout": 5,
     "headers": {"X-Dragon-Island": "$DRAGON_ISLAND_TOKEN", "X-Dragon-Cloud-Session": "$CLAUDE_CODE_REMOTE_SESSION_ID"},
     "allowedEnvVars": ["DRAGON_ISLAND_TOKEN", "CLAUDE_CODE_REMOTE_SESSION_ID"]}
hooks = cfg.setdefault("hooks", {})
for e in ["SessionStart", "UserPromptSubmit", "PostToolUse", "PermissionRequest", "Notification", "Stop", "StopFailure", "SessionEnd"]:
    keep = [g for g in hooks.get(e, []) if not any("/dragon-island/" in str(x.get("url", "")) for x in g.get("hooks", []))]
    hooks[e] = keep + [{"hooks": [h]}]
json.dump(cfg, open(p, "w"), indent=2)
print("Dragon Dynamic Island: hooks terpasang di", p)
PY
