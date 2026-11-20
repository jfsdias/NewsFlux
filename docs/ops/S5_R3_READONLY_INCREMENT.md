# S5-R3: read-only auditor increment and production image inventory (preparation only)

Track: `NEWSFLUX_S5_R3_READONLY_REMEDIATION_PREPARATION`. Status: **prepared offline, not run on OMV**.

This branch (`claude/newsflux-s5-r3-readonly-increment`) starts from PR #271 head `3822e09` without
changing PR #271. It authorizes nothing, including:

- a key update;
- a credential;
- a LiteLLM or Postgres write;
- inference or sending articles;
- a deploy or merge;
- a change to `s5_preflight.py` or to the S5 key contract.

## 1. What the increment adds to `s5_db_readonly_audit.py`

All additions are read-only and use the same probe as before. The probe runs a `READ ONLY`
transaction verified with `SHOW`, issues `SELECT` statements only, and runs with `python3 -B`. It
prints enums and counts only.

| Area              | New classifications                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Budget cause      | `KEY_MAX_BUDGET=MISSING\|INVALID\|NONPOSITIVE\|APP_CAP_MISSING\|ABOVE_APP_CAP\|OK`, `KEY_BUDGET_DURATION=MISSING\|BLANK\|UNRECOGNIZED\|CALENDAR_MONTH\|DAILY\|WEEKLY\|OTHER_WINDOW`, `KEY_SPEND_VS_MAX=BELOW\|AT_OR_ABOVE\|NOT_APPLICABLE`, `APP_BUDGET_CAP=PRESENT\|MISSING\|INVALID`, `KEY_BUDGET_CAUSE=<causes>\|NONE`. Each cause is consistent with the R1 `KEY_BUDGET` verdict, and a test proves it. |
| RPM / TPM         | `KEY_RPM` and `KEY_TPM` each `MISSING\|NON_INTEGER\|NONPOSITIVE\|APP_CAP_MISSING\|ABOVE_APP_CAP\|OK`. `KEY_RATE_LIMITS=PASS` holds only when both are `OK` (tested).                                                                                                                                                                                                                                        |
| Scope             | `KEY_SCOPE_TOKEN=ALL_PROXY_MODELS\|ALL_TEAM_MODELS\|STAR\|CONTAINS_STAR\|NONE`. These are LiteLLM keywords, never an alias.                                                                                                                                                                                                                                                                                 |
| Object permission | `OBJPERM_ROW=NONE\|PRESENT\|MISSING\|MULTIPLE`. A count per grant field, `OBJPERM_MCP_TOOL_SEARCH_ENABLED`, `OBJPERM_UNKNOWN_COLUMNS`, `OBJPERM_MISSING_COLUMNS`, `OBJPERM_UNRECOGNIZED_VALUES`, and `OBJPERM_EFFECTIVE=NONE\|EMPTY\|GRANTS_PRESENT\|UNKNOWN`. `blocked_tools` is a deny list and never counts as a grant. Unknown columns are counted from `information_schema` and never read.            |
| Extra mechanisms  | `KEY_EXTRA_INDIRECTION` lists any of USER, ORGANIZATION, PROJECT, AGENT, PERMISSIONS, CONFIG and BUDGET_FALLBACKS that are present (`*_UNRECOGNIZED` for an odd shape). `KEY_EXTRA_LIMITS` lists MODEL_MAX_BUDGET, BUDGET_LIMITS, TPD_LIMIT and MAX_PARALLEL_REQUESTS. Also `KEY_AGENT_ID=NONE\|PRESENT\|COLUMN_ABSENT` and `KEY_TYPE`.                                                                     |
| Schema / version  | `KEY_SCHEMA_COLUMNS`, `KEY_SCHEMA_UNKNOWN_COLUMNS` and `KEY_SCHEMA_MISSING_KNOWN` are compared with the 48 lab columns, giving `KEY_SCHEMA_COMPAT=LAB_EXACT\|UNKNOWN_COLUMNS\|MISSING_COLUMNS\|UNKNOWN_AND_MISSING_COLUMNS`. `LITELLM_VERSION` (digits only, e.g. `1_109_1`) and `LITELLM_VERSION_CLASS=LAB_REHEARSED\|NOT_REHEARSED\|UNKNOWN` come from package metadata; `litellm` is never imported.     |
| Strict gate       | `KEY_POLICY_GATE_R3` with `KEY_POLICY_GATE_R3_REASONS`, explained below.                                                                                                                                                                                                                                                                                                                                    |

**Two gates.** `KEY_POLICY_GATE` (the R1 contract) is **unchanged**, so the OMV receipt stays
comparable.

`KEY_POLICY_GATE_R3` is stricter:

- **When the R1 gate is not PASS,** the R3 gate equals it.
- **When the R1 gate is PASS,** the R3 gate becomes `NOT_VERIFIED` if any of these holds:
  - the schema is not `LAB_EXACT`;
  - the version was not rehearsed;
  - an extra indirection is present;
  - the budget duration is unrecognized;
  - an object permission is linked.
- **It never promotes.** A linked object permission keeps the gate `NOT_VERIFIED` even when the row
  is `EMPTY`. Accepting "empty is safe" would need its own contract and PM review.

**Never selected:** `key_name` (it holds a key fragment), `metadata` and any unknown column. The token
column is used only for the in-database fingerprint match, as in R1.

## 2. Optional private prestate (prepared, not run in production)

`--private-prestate ABSOLUTE_PATH` is opt-in and off by default.

**Path checks, before any Docker call:**

- the path must be absolute;
- its parent must be a real directory (no symlinked component) owned by root with mode `0700` (no
  group or other bits);
- the target must not exist.

Any failure prints `S5R3_PRIVATE_PRESTATE=HOLD_<reason>` and exits 2.

**What the probe returns.** Only when the host requested it, and only when exactly one key matched.

- **Key fields:** an allowlist of policy fields (`PRESTATE_KEY_FIELDS`). Never `token`, `key_name`,
  `metadata`, `config` or `permissions`.
- **Linked rows:** the known columns of the linked permission row, and the linked budget row.
- **Redaction:** values that look like secrets (`sk-…`, `://`, `os.environ/…`, 64-hex) are replaced
  with `REDACTED`, even inside allowed fields.

**Binding to the audited key:**

- the probe records the key fingerprint, `key_match=ONE`, the LiteLLM version, the schema class and
  the capture time;
- the host refuses the file unless that fingerprint equals the one the Summary container derived;
- the host then adds the full LiteLLM container ID and a hash of the container state snapshot.

**Write:**

- `O_CREAT|O_EXCL|O_NOFOLLOW` with mode `0600`, then `fsync` and a mode check;
- an existing file or a symlink is never followed or overwritten;
- only `S5R3_PRIVATE_PRESTATE_SHA256=<hex>` is printed;
- if the probe sends a prestate the host did not request, the run holds (`PROBE_OUTPUT_UNSAFE`).

Running it on OMV needs its own GO (`GO_S5R2_READONLY_RUN`).

## 3. Evidence (offline)

**Unit tests.** `test_s5_db_readonly_audit.py` has 118 tests: the 78 from R1 plus 40 for R3. They were
written first: 34 errors in RED, all passing in GREEN. The `release-governance` suite runs 225 tests,
all OK.

**Real lab rehearsal.** `rehearse-s5-r3-readonly-increment.sh` runs the pinned LiteLLM 1.109.1 and
Postgres images with synthetic keys. Result: **29/29 PASS**, exit 0. It covers:

- the exact budget cause, and RPM/TPM missing or above cap;
- the `ALL_PROXY_MODELS` token;
- a lab-exact schema and the rehearsed version;
- R1 and R3 both `PASS` for a clean key;
- the budget-table source;
- an `EMPTY` permission still giving `NOT_VERIFIED`;
- grant counts equal to the **stored** row, checked against a direct `psql` read. LiteLLM dropped an
  unresolvable MCP server name, and the auditor reports what is stored, not what was requested;
- `agent_id` reported as extra indirection, so the R3 gate is `NOT_VERIFIED`;
- the private prestate: 0600, bound to the key, redacted, never overwritten;
- an added column giving `UNKNOWN_COLUMNS` and an R3 gate of `NOT_VERIFIED`;
- no key, hash, fingerprint, alias, URL or DSN in any output.

**Ownership guard.** The rehearsal uses the same guard as the S5-R2 harness:

- a unique run ID plus a random nonce label;
- names refused if they already exist;
- created IDs recorded, and cleanup by owner nonce and ID only;
- no Docker removal before anything is created.

`--ownership-test` passes 3/3: decoys survive an early failure, a name collision is refused, and a
partial creation removes only owned resources. The `setup_mktemp` and `partial_create` faults each
exit 1.

**Not replayed:** the PR #271 copy of `rehearse-s5-db-audit.sh` still cleans up by name (`s5db-$$`).
It was not replayed here; it is safe only on an isolated CI runner. Fixing it belongs to PR #271's own
scope.

## 4. Production image inventory (Frente C)

There is no authorized agent access to OMV, so this is an operator command:

```bash
sudo bash deploy/release-governance/s5-litellm-image-inventory.sh \
  --container litellm --expect-id-prefix 09650c457315 --project litellm --service litellm
```

**What it reads:**

- **Container:** one container, matched by exact name, expected ID prefix and Compose labels.
- **Image:** read by its immutable ID; the image ID, `RepoDigests`, creation time, platform and the
  OCI version label.

**What it never does:** pull, run, restart, recreate, read the environment, mounts, ports or files,
or `exec`.

**Hold conditions:** the container state (ID, image, start time, restart count, status) must be
unchanged across the read, or the result is a HOLD.

**Version read:** optional, and only with `--with-version-read <approval-ref>`. It is one
`docker exec <full-ID> python3 -B -I -c importlib.metadata.version("litellm")`. It needs an
explicit PM or owner approval reference, because the PM allows exec only for an approved
version read.

**Tests:** `test_s5_litellm_image_inventory.py` has 9 tests with a fake `docker` that records every
call. They prove:

- no forbidden subcommand is issued;
- holds happen for an identity mismatch, a container stopped or changed during the read, and an
  unreadable image;
- injected values are sanitized;
- the version read requires an approval reference.

It was also run once against a real lab container.

**Identifiers are not interchangeable:**

- **`IMAGE_ID`:** the local image ID. With the classic image store it is the config digest; with the
  containerd store it is the manifest digest.
- **`REPO_DIGESTS`:** registry manifest digests.

### Lab equivalence procedure (disposable lab only, never on OMV)

1. **Pull by digest in the lab:** `docker pull <repo>@<digest from S5R3_INV_REPO_DIGESTS>`.
2. **Prove it is the same image.** Fetch that manifest's config digest (for example
   `docker buildx imagetools inspect --raw <repo>@<digest>`, selecting `linux/amd64`). It must equal
   the production `S5R3_INV_IMAGE_ID` when production uses the classic store, or `IMAGE_ID` must
   equal the digest when it uses containerd. If they differ, stop: the image is not equivalent.
3. **Read the version in the lab image.** Once equivalence is proven, the version read in the lab
   is the production version.
4. **Re-run the lab harnesses against that image:**
   - the key-policy harness:
     `LITELLM_IMAGE=<repo>@<digest> S5R2C_EXPECTED_LITELLM_VERSION=<version> bash rehearse-s5-key-policy-update.sh`;
   - this increment's rehearsal.

   An unknown schema fails both, closed.

5. **Rehearsed versions are code.** Only after a passing rehearsal may a later PR add that version to
   `LAB_REHEARSED_VERSIONS` and adjust `R3_KNOWN_KEY_COLUMNS`. Until then the R3 gate stays
   `NOT_VERIFIED` for it.

## 5. Decision D1 (unchanged)

`D1=OWNER_OPEN`. The PM recommends **D1-B**: an explicit admin allowlist, never a wildcard. It must
keep model discovery separate from approval for inference, cost, consent and fallback. No S5 contract
or `s5_preflight.py` change happens before the owner decides. Neither option authorizes a key write.

## 6. Next gate

1. **PM review of this branch.**
2. **Owner runs the inventory command** (metadata only) and shares the `S5R3_INV_*` lines.
3. **Lab equivalence and rehearsal** against that digest.
4. **`GO_S5R2_READONLY_RUN`** for the increment on OMV, optionally with the private prestate.
5. **Owner decision on D1.**

`S5_PREFLIGHT=BLOCKED` and `S5_ACTIVATION=NO_GO` are unchanged.

## 7. Exact production image in the disposable lab (GO-NEWSFLUX-S5-R3-EXACT-IMAGE-LAB)

Authorized for the disposable lab only, with synthetic keys and database. Nothing ran on OMV beyond
the owner's metadata-only inventory.

**Inventory (operator, metadata only):**

- container `09650c4573154471943d576a4a2429ac3c7a3f5fecb2e132a5444be51789e50b`, unchanged during the read;
- reference `ghcr.io/berriai/litellm-database:main-latest` (a moving tag);
- image ID `sha256:95017a6781a986878745e4577172c9f5e74a060d5311491ce452bd9015d2f5ab`;
- `RepoDigests` `ghcr.io/berriai/litellm-database@sha256:eb7a0adff81ce89de44a8985d411b89d628f96d2dfb69e3d55eaf61dd4db143a`;
- `linux/amd64`, created 2026-11-12T01:45:36Z;
- no OCI version label.

**Equivalence, proven twice (before and after the pull):**

- the index digest above resolves to the `linux/amd64` manifest `sha256:afaa1463…f538`;
- that manifest's **config digest is `sha256:95017a67…f5ab`, exactly the production image ID**;
- the lab pulled it **by digest** (never by tag).

**Package version:** read in a `--network none` container with `python3 -B -I`
(`importlib.metadata`). It is **`1.110.0`**, not 1.109.1.

**Revalidation for 1.110.0.** Behaviour, through both lab harnesses against the exact image:

| Run                                                                                                                  | Result                                                                                                                                                                                                                                                                                                                                                     | Exit |
| -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| Key-policy harness (plan branch `7811f80`), `LITELLM_IMAGE=<exact digest>`, `S5R2C_EXPECTED_LITELLM_VERSION=1.110.0` | **52/52 PASS**. Schema 48 key / 13 permission columns, none unknown or missing; all 18 auditor columns compared; 404 `not_found_error` / 422 `int_parsing` refusals with state unchanged; partial rollback detected; reset exactly 2026-12-01T00:00Z; rollback equal to the prestate; R1 gate `NOT_VERIFIED` with the permission linked and `PASS` without | 0    |
| Increment rehearsal, `S5R3_LITELLM_IMAGE=<exact digest>`, `S5R3_EXPECTED_LITELLM_VERSION=1.110.0`                    | **29/29 PASS**. Budget causes, RPM/TPM, permission counts as stored, extra mechanisms, private prestate, schema drift. A clean key gives R1 `PASS` and **R3 `NOT_VERIFIED` with the single reason `VERSION_NOT_REHEARSED`** (fail closed)                                                                                                                  | 0    |
| Increment rehearsal, default lab image (regression)                                                                  | 29/29 PASS, R3 `PASS`                                                                                                                                                                                                                                                                                                                                      | 0    |
| Negatives                                                                                                            | tag reference, missing expected version and wrong expected version (1.109.1 against 1.110.0) each refuse; key-policy faults are listed in the PR follow-up                                                                                                                                                                                                 | 1    |

**Source comparison** of the two images (files read in `--network none` containers):

- **`duration_parser.py`: identical.** The `30d` budget semantics are unchanged.
- **`schema.prisma`:** changes only outside the tables S5 uses. `LiteLLM_VerificationToken`,
  `LiteLLM_ObjectPermissionTable`, `LiteLLM_BudgetTable`, `LiteLLM_ProxyModelTable` and
  `LiteLLM_Config` are identical; the changes are new plugin and skill tables.
- **`auth_checks.py`:** `can_agent_call_model`, `can_key_call_model`, `_can_object_call_model` and
  `can_team_access_model` are identical. The object-permission helpers are identical, so F11 holds
  for 1.110.0.
- **`key_management_endpoints.py`:** `prepare_key_update_data` is identical. `update_key_fn` changed
  only in the branch that runs when a request sets `spend` (the spend-counter cache). The S5 update
  never sets `spend`.
- **`user_api_key_auth.py`:** changed (about 178 lines). This was **not** source-reviewed in full; it
  is covered only by behaviour (the same key still authenticates, and the catalog is exactly the
  alias).

**Decision left to the PM:**

- The auditor keeps `LAB_REHEARSED_VERSIONS={"1.109.1"}`, so on OMV today `KEY_POLICY_GATE_R3`
  would be `NOT_VERIFIED` (`VERSION_NOT_REHEARSED`) even after a correct key fix.
- Adding `1.110.0` is a one-line, deliberate change. It is now supported by the two passing
  rehearsals above, but this branch does **not** make it without PM review.
- Production parity of the _image_ is proven. Runtime parity is still not covered: caches,
  environment overrides, egress, and the YAML and DB contents of the real gateway.
