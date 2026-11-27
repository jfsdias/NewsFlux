# D1 complementary capture — proposal (needs its own owner authorization)

Status: **proposed, not authorized, not executed.** `ADDITIONAL_CAPTURE_REQUIRED=YES`.

## Why the authorized diagnostic is not enough

The R5 diagnostic (`GO-NEWSFLUX-S5-R5-READONLY-57C536F`, executor `operator-command.txt` at `a9eda2b`) stays
authorized and unchanged. It should run as authorized, independently of this proposal. Its receipt alone cannot
prove D1 cost authority, for these reasons:

- **Key.** The auditor reads the Summary key fingerprint and matches it in the LiteLLM DB, but the authorized run
  forbids `--private-prestate`. So the fingerprint is not in the receipt. Binding it afterwards needs a later
  `docker exec`, and a key changed in the same container would then inherit the old facts.
- **Time.** The saved receipt carries no capture time other than its file mtime, and an mtime is not proof.
- **Exit code.** The executor's exit code is not stored in the saved receipt.

These gaps are in what the authorized run records, not in its gates. Changing that run is out of scope: pins,
executor and SHA stay as they are.

## What the capture does (one root invocation, read-only toward Docker/LiteLLM/DB)

`ops/deploy/release-governance/d1_capture.py` (#274), with the admitted auditor (57c536f, sha256 `6e5bef4e…`):

1. Verifies the auditor sha256 and the vendored receipt contract (sha256 `7aa686a3…`, verbatim from 57c536f).
2. Reads the Summary and LiteLLM identity lines. The LiteLLM image ID and repo digest must equal the R5 pins.
3. Runs the auditor **once** in strict mode with `--private-prestate`. In that single run it reads the key
   fingerprint, matches it, and writes the same fingerprint, the read time and the key policy into a root-only
   prestate (0600). It prints the prestate's sha256 in its receipt. The exit code is recorded.
4. Reads the identity lines again; they must be byte-identical.
5. Writes `evidence.json` (0644, no amounts: the policy stays in the prestate). It verifies the file with the same
   code the Summary uses, then prints `D1CAPTURE_EVIDENCE_SHA256`.

Its only writes are to a new root-only `mktemp -d /root/newsflux-d1.XXXXXXXX`. It makes no key, configuration,
database or container change, no inference and no article transfer. It needs no admin key, no signer and no new
service. `AI flags` must be OFF (dark Summary), as for the diagnostic.

## After the capture

1. Record `D1CAPTURE_EVIDENCE_SHA256` and `D1CAPTURE_CAPTURED_AT` in the homeserver ledger. That record is the
   external witness of the capture.
2. Within 7 days, run the release preflight in the target configuration (see `AI_MODEL_CATALOG.md`, Release
   transition): `RELEASE_MODE=d1 … ai-functional-release.sh d1-preflight`. This changes nothing.
3. Activation (`enable-s5` in D1 mode) needs its own GO. It requires the owner's external-transfer consent and the
   declaration (`gateway_budget_enforced` recommended; `explicit_unlimited` only with a ledger decision).

## Operator command (file pins below; `<PR274_HEAD>` = the reviewed #274 head that contains these exact files)

```
bash -o pipefail -c 'set -Eeuo pipefail; umask 077; s="$(mktemp -d /root/newsflux-d1src.XXXXXXXX)"; o="$(mktemp -d /root/newsflux-d1.XXXXXXXX)";
B=https://raw.githubusercontent.com/jfsdias/NewsFlux;
curl -fsS --max-time 60 -o "$s/auditor.py" "$B/57c536fb583a52bb42a88d9a1b051869abc64b1f/deploy/release-governance/s5_db_readonly_audit.py";
curl -fsS --max-time 60 -o "$s/d1_capture.py" "$B/<PR274_HEAD>/ops/deploy/release-governance/d1_capture.py";
curl -fsS --max-time 60 -o "$s/d1_evidence.py" "$B/<PR274_HEAD>/services/article_intel_summary/d1_evidence.py";
curl -fsS --max-time 60 -o "$s/d1_receipt_contract.py" "$B/<PR274_HEAD>/services/article_intel_summary/d1_receipt_contract.py";
printf "%s\n" "6e5bef4ed383e43b16264ce4a94bd82ad5f4b0523b1bbf2b57e7576490f14d11  $s/auditor.py" "fcf746fd270ecf77a7b682e221ae6403a7923280ddca992ba7873d100392e636  $s/d1_capture.py" \
  "91aaccfba9ace00a18c135a5665989c4202a69b652f002984504d2aec0c8018c  $s/d1_evidence.py" "e4e210ebdff161dbd5ef79336da01ab6180cc9b8d56831808b0262ed4740fd44  $s/d1_receipt_contract.py" | sha256sum -c --quiet;
summary="$(docker ps -q --no-trunc --filter label=com.docker.compose.project=newsflux --filter label=com.docker.compose.service=summary-api)";
python3 -I -B "$s/d1_capture.py" --auditor "$s/auditor.py" --expect-auditor-sha256 6e5bef4ed383e43b16264ce4a94bd82ad5f4b0523b1bbf2b57e7576490f14d11 \
  --evidence-lib "$s" --summary-container "$summary" --litellm-container 09650c4573154471943d576a4a2429ac3c7a3f5fecb2e132a5444be51789e50b \
  --expect-litellm-image sha256:95017a6781a986878745e4577172c9f5e74a060d5311491ce452bd9015d2f5ab \
  --expect-repo-digest ghcr.io/berriai/litellm-database@sha256:eb7a0adff81ce89de44a8985d411b89d628f96d2dfb69e3d55eaf61dd4db143a \
  --expect-litellm-version 1.110.0 --project newsflux --summary-service summary-api \
  --declaration gateway_budget_enforced --out-dir "$o"'
```

The LiteLLM container ID, image ID and repo digest are the R5 pins. The PM re-confirms them before
authorizing. If the LiteLLM container was recreated since R5, the capture stops with `HOLD_LITELLM_IDENTITY`; it
never guesses. Printed output: gate names, the auditor's classifications, the evidence sha256 and the capture time.
It never prints the key or the policy amounts.

## Authorization text proposed to the owner

> AUTORIZO GO-NEWSFLUX-D1-CAPTURE-1: uma única execução supervisionada do comando de captura D1 nos pins acima,
> com `--private-prestate` gravando apenas em diretório novo `/root/newsflux-d1.*` (0700), sem alteração de chave,
> configuração, banco ou contêiner, sem inferência e sem transferência de artigo; o digest da evidência será
> registrado no ledger.
