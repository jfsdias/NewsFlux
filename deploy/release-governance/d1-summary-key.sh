#!/usr/bin/env bash
# D1: new LiteLLM virtual key for the NewsFlux Summary with an explicit (reduced) model list, then the D1 capture.
#
# Run on the OMV as root, interactively. Owner action: it CREATES a LiteLLM key, may set model_info.mode=chat on the
# chosen deployments, and REPLACES the Summary's key file (backup kept). It never prints a key, the master key or
# provider settings. The old key is not deleted or blocked (rollback = restore the backup file).
#
# Steps: 1 list the proxy models -> 2 YOU choose the models (numbers) and the budget -> 3 confirm -> 4 mode chat on the
# chosen deployments -> 5 key: explicit models, max_budget + budget_duration, rpm/tpm, llm_api_routes only, no user
# -> 6 key file replaced in place (same inode, owner, mode) -> 7 Summary sees exactly the chosen models ->
# 8 optional: D1 capture (needs its own GO).
set -Eeuo pipefail
umask 077
LITELLM_CID="${LITELLM_CID:-09650c4573154471943d576a4a2429ac3c7a3f5fecb2e132a5444be51789e50b}"
PROJECT="${NEWSFLUX_PROJECT:-newsflux}"
SERVICE="${NEWSFLUX_SUMMARY_SERVICE:-summary-api}"
say() { printf 'D1KEY %s\n' "$*"; }
die() { say "STOP: $*"; exit 1; }
[[ "$(id -u)" == 0 ]] || die "run as root"
[[ "$(docker inspect -f '{{.State.Running}}' "$LITELLM_CID" 2>/dev/null)" == true ]] || die "LiteLLM container $LITELLM_CID not running"
SUMMARY="$(docker ps -q --no-trunc --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=$SERVICE")"
[[ -n "$SUMMARY" && "$(wc -l <<<"$SUMMARY")" == 1 ]] || die "Summary container not unique"
KEY_IN_CONTAINER="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$SUMMARY" | sed -n 's/^NEWSFLUX_AI_LITELLM_VIRTUAL_KEY_FILE=//p' | head -1)"
KEY_FILE="$(docker inspect -f "{{range .Mounts}}{{if eq .Destination \"$KEY_IN_CONTAINER\"}}{{.Source}}{{end}}{{end}}" "$SUMMARY")"
[[ -n "$KEY_IN_CONTAINER" && -f "$KEY_FILE" && ! -L "$KEY_FILE" ]] || die "Summary key file not found as a bind-mounted file"
KEY_STAT="$(stat -c '%u:%g %a %i' "$KEY_FILE")"

# Admin calls run INSIDE the LiteLLM container with its own LITELLM_MASTER_KEY; nothing secret leaves it except the
# new virtual key, which goes straight into the key file.
admin() { # python program on stdin of this function's caller is not used; argument 1 = program, rest = args
  local program="$1"; shift
  docker exec "$LITELLM_CID" python3 -B -I -c "$program" "$@" </dev/null
}
COMMON='
import json, os, sys, urllib.error, urllib.request
MASTER = os.environ.get("LITELLM_MASTER_KEY", "")
if not MASTER.startswith("sk-"):
    print("NO_MASTER_KEY_IN_CONTAINER"); sys.exit(3)
def call(method, path, body=None):
    req = urllib.request.Request("http://127.0.0.1:4000" + path, method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + MASTER})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.status, json.loads(resp.read() or b"null")
    except urllib.error.HTTPError as error:
        return error.code, None
'

# 1. models on the proxy (alias, mode, deployments) - no endpoints, no keys
say "1/8 modelos no proxy LiteLLM:"
LIST="$(admin "$COMMON"'
status, info = call("GET", "/model/info")
if status != 200: print("MODEL_INFO_FAILED"); sys.exit(3)
seen = {}
for d in info.get("data", []):
    name = d.get("model_name"); mode = (d.get("model_info") or {}).get("mode")
    entry = seen.setdefault(name, {"modes": set(), "count": 0})
    entry["modes"].add(mode or "-"); entry["count"] += 1
for i, name in enumerate(sorted(seen), 1):
    modes = ",".join(sorted(seen[name]["modes"])); count = seen[name]["count"]
    print(f"{i}\t{name}\tmode={modes}\tdeployments={count}")
')" || die "could not list models ($LIST)"
printf '%s\n' "$LIST" | awk -F'\t' '{printf "   %3s) %-40s %s %s\n", $1, $2, $3, $4}'

# 2. YOUR choice: the reduced model list and the budget
echo
read -r -p "D1KEY 2/8 Numeros dos modelos (ex.: 1,3) ou 'todos' = todos os modelos de chat: " PICK
# Summaries need chat models: rerank/embedding/audio/image/moderation models are refused (never marked chat).
MODELS="$(python3 -I -c '
import re, sys
NOT_CHAT = re.compile(r"rerank|embed|whisper|tts|speech|transcri|audio|image|dall-e|moderation|vision-embed", re.I)
rows = [l.split("\t") for l in sys.argv[1].splitlines()]
names = [r[1] for r in rows]
modes = {r[1]: r[2].removeprefix("mode=") for r in rows}
choice = sys.argv[2].strip().lower()
if choice == "todos":
    picked = [n for n in names if not NOT_CHAT.search(n) and set(modes[n].split(",")) <= {"chat", "-"}]
else:
    picked = []
    for part in choice.replace(" ", "").split(","):
        if not part.isdigit() or not 1 <= int(part) <= len(names): sys.exit("invalid choice: " + part)
        name = names[int(part) - 1]
        if NOT_CHAT.search(name) or not set(modes[name].split(",")) <= {"chat", "-"}:
            sys.exit("not a chat model (cannot summarize): " + name)
        if name not in picked: picked.append(name)
if not picked: sys.exit("no chat model chosen")
print(",".join(picked))' "$LIST" "$PICK")" || die "invalid model choice ($MODELS)"
read -r -p "D1KEY    Orcamento max_budget em USD (> 0, ex.: 5): " BUDGET
read -r -p "D1KEY    Janela budget_duration [30d]: " DURATION; DURATION="${DURATION:-30d}"
read -r -p "D1KEY    rpm_limit [30]: " RPM; RPM="${RPM:-30}"   # discovery and preflight also count
read -r -p "D1KEY    tpm_limit [20000]: " TPM; TPM="${TPM:-20000}"
[[ "$BUDGET" =~ ^[0-9]+(\.[0-9]+)?$ ]] && python3 -c "import sys; sys.exit(0 if float(sys.argv[1])>0 else 1)" "$BUDGET" || die "max_budget must be > 0"
[[ "$DURATION" =~ ^[0-9]+[smhd]$|^[0-9]+mo$ ]] || die "budget_duration like 30d, 1mo"
[[ "$RPM" =~ ^[1-9][0-9]*$ && "$TPM" =~ ^[1-9][0-9]*$ ]] || die "rpm/tpm must be positive integers"

# 3. confirm
echo
say "3/8 Resumo:"
say "    modelos      = $MODELS"
say "    max_budget   = $BUDGET USD / $DURATION    rpm=$RPM tpm=$TPM    rotas=llm_api_routes    sem usuario"
say "    arquivo-chave = $KEY_FILE (sera substituido; backup root 0600)"
read -r -p "D1KEY    Digite CRIAR para continuar: " OK
[[ "$OK" == CRIAR ]] || die "cancelled (nothing changed)"

# 4. model_info.mode = chat on the chosen deployments (the catalog's capability gate). A model whose deployment cannot
#    be updated (e.g. defined in the YAML config) or whose name NewsFlux cannot address (e.g. trailing space) is left
#    out of the key, by name, instead of stopping: it would never be offered anyway.
say "4/8 mode=chat nos modelos escolhidos"
OUT="$(admin "$COMMON"'
import re
status, info = call("GET", "/model/info")
wanted = sys.argv[1].split(",")
valid = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:/-]*")
dropped = [n for n in wanted if not (1 <= len(n) <= 128 and n == n.strip() and n.isascii() and valid.fullmatch(n))]
ok = {}
changed = kept = 0
for d in info.get("data", []):
    name = d.get("model_name")
    if name not in wanted or name in dropped: continue
    mi = d.get("model_info") or {}
    if mi.get("mode") == "chat":
        kept += 1; ok.setdefault(name, True); continue
    s, _ = call("PATCH", "/model/" + str(mi.get("id")) + "/update", {"model_info": {"mode": "chat"}})
    if s == 200:
        changed += 1; ok.setdefault(name, True)
    else:
        ok[name] = False   # one deployment of this alias could not be marked chat: leave the alias out
keep = [n for n in wanted if ok.get(n) is True]
dropped += [n for n in wanted if n not in keep and n not in dropped]
print(f"MODE_CHAT changed={changed} already={kept} dropped={len(dropped)}")   # never the response (it holds encrypted params)
print("KEEP=" + ",".join(keep))
print("DROPPED=" + " | ".join(dropped))
sys.exit(0 if keep else 1)
' "$MODELS")" || die "no model could be marked chat ($OUT)"
say "    $(sed -n 1p <<<"$OUT")"
[[ -n "$(sed -n 's/^DROPPED=//p' <<<"$OUT")" ]] && say "    fora da chave: $(sed -n 's/^DROPPED=//p' <<<"$OUT")"
MODELS="$(sed -n 's/^KEEP=//p' <<<"$OUT")"
say "    modelos na chave: $MODELS"

# 5. the key (no user_id, explicit models, budget, limits, LLM routes only)
say "5/8 criando a chave"
STAMP="$(date -u +%Y%m%d%H%M%S)"
NEWKEY="$(admin "$COMMON"'
models = sys.argv[1].split(",")
body = {"models": models, "max_budget": float(sys.argv[2]), "budget_duration": sys.argv[3],
        "rpm_limit": int(sys.argv[4]), "tpm_limit": int(sys.argv[5]), "allowed_routes": ["llm_api_routes"],
        "key_alias": "newsflux-summary-d1-" + sys.argv[6], "metadata": {"purpose": "newsflux-summary-d1"}}
status, doc = call("POST", "/key/generate", body)
key = (doc or {}).get("key", "") if status == 200 else ""
if not key.startswith("sk-"): print("KEY_GENERATE_FAILED"); sys.exit(3)
s, info = call("GET", "/key/info?key=" + key)
i = (info or {}).get("info") or {}
ok = (s == 200 and sorted(i.get("models") or []) == sorted(models) and not i.get("user_id") and not i.get("team_id")
      and (i.get("max_budget") or 0) > 0 and i.get("budget_duration") and i.get("allowed_routes") == ["llm_api_routes"])
if not ok: print("KEY_POLICY_NOT_AS_REQUESTED"); sys.exit(3)
print(key)
' "$MODELS" "$BUDGET" "$DURATION" "$RPM" "$TPM" "$STAMP")" || die "key not created as requested"
[[ "$NEWKEY" == sk-* && "$NEWKEY" != *$'\n'* ]] || die "unexpected key output"
say "    chave criada (alias newsflux-summary-d1-$STAMP; valor nao exibido)"

# 6. key file: backup, then replace IN PLACE (same inode: the bind mount keeps working; owner and mode unchanged)
BACKUP="$(mktemp -d /root/newsflux-key-backup.XXXXXXXX)"
cp -p "$KEY_FILE" "$BACKUP/previous-key"; chmod 0600 "$BACKUP/previous-key"
restore() { cat "$BACKUP/previous-key" >"$KEY_FILE"; say "    arquivo-chave restaurado do backup"; }
printf '%s\n' "$NEWKEY" >"$KEY_FILE" || { restore; die "could not write key file"; }
unset NEWKEY
[[ "$(stat -c '%u:%g %a %i' "$KEY_FILE")" == "$KEY_STAT" ]] || { restore; die "key file owner/mode/inode changed"; }
say "6/8 arquivo-chave substituido (backup: $BACKUP/previous-key)"

# 7. the Summary (as its own user) sees exactly the chosen models with the new key
SEEN="$(docker exec -u 10001 "$SUMMARY" python -B -c '
import os
from services.article_intel_summary.litellm_adapter import load_litellm_settings
from services.article_intel_summary.s5_preflight import _gateway_getter, simulated_environment
s = load_litellm_settings(simulated_environment(os.environ))
print(",".join(sorted(i.get("id") for i in _gateway_getter(s)("/v1/models").get("data", []) if isinstance(i, dict))))
' </dev/null 2>/dev/null || true)"
if [[ "$SEEN" == "$(tr ',' '\n' <<<"$MODELS" | sort | paste -sd,)" ]]; then
  say "7/8 Summary ve exatamente: $SEEN"
else
  restore; die "Summary does not see exactly the chosen models with the new key (saw: ${SEEN:-nothing}); old key restored"
fi
say "    a chave antiga NAO foi bloqueada; bloqueie-a so depois de validar o novo caminho"

# 8. D1 capture (needs GO-NEWSFLUX-D1-CAPTURE-2; release preflight accepts it for 24 h)
echo
read -r -p "D1KEY 8/8 Executar a captura D1 agora (GO-NEWSFLUX-D1-CAPTURE-2)? Digite CAPTURAR ou Enter para sair: " CAP
[[ "$CAP" == CAPTURAR ]] || { say "fim sem captura"; exit 0; }
s="$(mktemp -d /root/newsflux-d1src.XXXXXXXX)"; o="$(mktemp -d /root/newsflux-d1.XXXXXXXX)"
B=https://raw.githubusercontent.com/jfsdias/NewsFlux; H=94a36e7d690ff3ba28962be78a9fe084b6e2ffd7
curl -fsS --max-time 60 -o "$s/auditor.py" "$B/57c536fb583a52bb42a88d9a1b051869abc64b1f/deploy/release-governance/s5_db_readonly_audit.py"
curl -fsS --max-time 60 -o "$s/d1_capture.py" "$B/$H/deploy/release-governance/d1_capture.py"
curl -fsS --max-time 60 -o "$s/d1_evidence.py" "$B/$H/services/article_intel_summary/d1_evidence.py"
curl -fsS --max-time 60 -o "$s/d1_receipt_contract.py" "$B/$H/services/article_intel_summary/d1_receipt_contract.py"
printf "%s\n" "6e5bef4ed383e43b16264ce4a94bd82ad5f4b0523b1bbf2b57e7576490f14d11  $s/auditor.py" \
  "fcf746fd270ecf77a7b682e221ae6403a7923280ddca992ba7873d100392e636  $s/d1_capture.py" \
  "91aaccfba9ace00a18c135a5665989c4202a69b652f002984504d2aec0c8018c  $s/d1_evidence.py" \
  "e4e210ebdff161dbd5ef79336da01ab6180cc9b8d56831808b0262ed4740fd44  $s/d1_receipt_contract.py" | sha256sum -c --quiet
python3 -I -B "$s/d1_capture.py" --auditor "$s/auditor.py" --expect-auditor-sha256 6e5bef4ed383e43b16264ce4a94bd82ad5f4b0523b1bbf2b57e7576490f14d11 \
  --evidence-lib "$s" --summary-container "$SUMMARY" --litellm-container "$LITELLM_CID" \
  --expect-litellm-image sha256:95017a6781a986878745e4577172c9f5e74a060d5311491ce452bd9015d2f5ab \
  --expect-repo-digest ghcr.io/berriai/litellm-database@sha256:eb7a0adff81ce89de44a8985d411b89d628f96d2dfb69e3d55eaf61dd4db143a \
  --expect-litellm-version 1.110.0 --project "$PROJECT" --summary-service "$SERVICE" \
  --declaration gateway_budget_enforced --out-dir "$o"
