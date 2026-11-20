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

## 8. Version admission (1.110.0) and operator readiness (S5-R3, PM comment 7041768917)

### 8.1 Focused authentication review

Sources were extracted from both exact images in `--network none` containers (SHA-256):

| File                                                          | 1.109.1 lab image                                                  | 1.110.0 production image                                           |
| ------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `proxy/auth/user_api_key_auth.py`                             | `fba7e31fc115889f486493cccc267898c6bfafd9d6afcd9737e578250fe564d4` | `3f6e5ba25f763c6af357c280b6acf5fcc3e7a0870df7d615b1990cc22ce6562d` |
| `proxy/pass_through_endpoints/codex_passthrough_endpoints.py` | `561ad21824130cee8ff826c1be5a41d2e02e80a40b4425185d2835250c9dd2fd` | `0554236a9b99cb7a7de2758113119dc7d5a2a0b2e42df4820ca587b5b2140f8d` |
| `repositories/verification_token_repository.py`               | `560c5df88118f6fb26c7554bc1ea1059fb1128a588203b849512308043446346` | `051c296999360dc2bfd388acba2cbf083f1814c233e61bc567b9963314d0dc22` |
| `proxy/_types.py`                                             | `87208c437e48a85726343fcb94579d44cde19e02cc560247b90a21c7d18416b8` | `e5cef90f0923dabe8268fffa5f2018b5c2a37ff0babc7a799e779e365dd46616` |
| `proxy/auth/auth_checks.py`                                   | `7a7fecda26443fb49e9c381eff5a01fd5bf8b29d40755494e54907778fe09e40` | `84ad8222f50270c3ab587ff4c713cc68d8af6bd88afe320a4aa5c28d0115fd4f` |
| `proxy/management_endpoints/key_management_endpoints.py`      | `cb8ad39b186b8cc39e2e9950edc545277977224413581f31f00c0098c32c5647` | `477375652f3fb667bae7116cbebb6f9a8f2b44cbcd23532f45dbb7cecac607c0` |

The full `user_api_key_auth.py` diff (about 178 changed lines) was reviewed. Findings by area:

- **Virtual-key authentication:** unchanged for virtual keys. The new code is in JWT key mapping,
  the Codex native route, realtime WebSockets, spend-counter storage, the cache prefetch and
  telemetry.
- **Model authorization:**
  - `can_key_call_model`, `can_team_access_model` and `_can_object_call_model` are identical, and
    `enforce_key_and_fallback_model_access` still checks the key's model list.
  - 1.110.0 adds `_resolve_codex_native_chatgpt_model`. On `/backend-api/codex/responses` it rewrites
    a model to `chatgpt/<model>`, but only when the key may call that rewritten model
    (`_key_and_team_allow`), and the rewrite happens before the same key check.
  - `model_group_alias` resolution now also reaches that pass-through route, again before the key
    check.
- **Routes:** in both versions, `llm_api_routes` includes `mapped_pass_through_routes`
  (`/backend-api/codex`, `/anthropic`, `/gemini`, `/bedrock`, `/vertex_ai`, …). **This predates
  1.110.0**; see 8.4.
- **Inherited permissions:**
  - A new JWT `LINK_ONLY` mode, and the repository lookup renamed from
    `find_newest_reusable_llm_api_key` to `find_newest_reusable_key`, which **no longer requires**
    `allowed_routes` to be empty or `llm_api_routes`.
  - Effect: with `general_settings.enable_jwt_auth: true` and LINK_ONLY or map-existing, a JWT
    identity with the same `user_id` can be linked to any unexpired, unblocked key of that user.
- **RPM, TPM and budget:**
  - The spend counters moved to a `SpendCounterStore`; key, budget and `duration_parser.py` logic is
    identical.
  - The only key-update change is the `spend` branch, which S5 never uses.
  - Enforcement at runtime is not exercised (that would need inference).
- **Cache and invalidation:** `arm_routing_cooldowns` only prefetches routing cooldowns in the same
  round trip; there is no policy-cache change.
- **Bypass probe, both images:** `rehearse-s5-r3-auth-surface.sh` runs on an internal network with no
  egress and a synthetic key scoped to one alias.
  - Another model is refused at authentication (403) on `/v1/chat/completions`, `/v1/responses`,
    `/backend-api/codex/responses`, `/anthropic/v1/messages` and `/gemini/...:generateContent`.
  - The alias is admitted.
  - The results are **identical** on 1.109.1 and 1.110.0, with the expectation declared per probe.
    Exit 0 on both.

**Verdict:** no blocker for diagnostic admission. The only new mechanism, JWT linking, is now
**detected**: `JWT_AUTH=ENABLED|DISABLED|UNRECOGNIZED|UNKNOWN`, read from `general_settings` in the
DB and YAML. Anything other than `DISABLED` gives `KEY_POLICY_GATE_R3=NOT_VERIFIED`, with reason
`JWT_AUTH_NOT_DISABLED`. An unreadable YAML gives `UNKNOWN`, which is never treated as disabled.

### 8.2 Admission

`LAB_REHEARSED_VERSIONS = {"1.109.1", "1.110.0"}`. Admission is diagnostic only and approves no
production configuration. Preserved, and tested with literal expectations independent of the
allowlist:

- 1.109.1 stays compatible;
- unrehearsed versions (1.110.1, 1.109.0, 1.111.0, 2.0.0, malformed, unknown) stay `NOT_VERIFIED`;
- R1 `FAIL` or `NOT_VERIFIED` is never promoted;
- a linked object permission stays `NOT_VERIFIED`;
- an unknown schema or extra indirection stays `NOT_VERIFIED`;
- the S5 contract and `s5_preflight.py` are unchanged.

### 8.3 Evidence

- **Unit tests:**
  - auditor 128 (10 new, RED 5 failures + 3 errors → GREEN);
  - inventory 9;
  - wrapper 13 (all gates and holds);
  - the `release-governance` suite is OK with `-B`.
- **Real lab, increment rehearsal:** 31/31 on **both** exact images.
  - Expected classes come from a literal table, so the clean key is R3 `PASS` on 1.109.1 and on
    1.110.0.
  - Live checks: JWT enabled blocks R3, and the restore returns it to `PASS`; schema drift blocks it.
  - A wrong expected version is refused (exit 1), and the ownership test passes.
- **Auth-surface probe:** 7/7 PASS on both images.
- **Cleanup and secrets:** 0 leftover containers or networks; no secrets in any output.

### 8.4 Operator wrapper (prepared, NOT run; PM GO required)

`deploy/release-governance/s5-r3-omv-readonly-run.sh` runs these gates in order, and holds with no
further call at the first failure:

1. **G1, exact source:** a clean checkout at the expected HEAD; the auditor file tracked,
   unmodified, with a pinned SHA-256.
2. **G2, CI:** the GitHub check runs on that exact SHA include `synthetic-release` with success, and
   none failed or is pending.
3. **G3, LiteLLM:** the container is matched by full ID, is running, runs the expected image ID, and
   that image's RepoDigests contain the expected digest.
4. **G4, binding:** the image ID must be in the wrapper's table of lab-proven images for the expected
   version. Today that is only `sha256:95017a67…f5ab` → 1.110.0.
5. **G5, Summary:** exactly one Summary container, whose image revision label equals the expected
   production revision.
6. **Run:** the auditor itself refuses unless the inference and external-transfer flags are OFF, and
   it checks the read-only transaction and that the containers are unchanged.
7. **Post:** only sanitized enum lines are printed, otherwise the run holds. The receipt must show
   version `1_110_0` as `LAB_REHEARSED`, `DB_READ_ONLY=VERIFIED`, `CONTAINER_IDENTITY=UNCHANGED` and
   `COMPLETE`. G3 is re-checked after the run.

`PRIVATE_PRESTATE` is OFF: any argument containing "prestate" makes the wrapper hold.

### 8.5 Residual risks

- **Pre-existing, P1 for the key target:** `allowed_routes=["llm_api_routes"]` admits provider
  pass-through routes. The key's model scope held on every probed route, but the policy should name
  explicit routes. That belongs to the D1-B contract, by owner and PM decision; it is not changed
  here.
- **Runtime parity** (caches, environment, egress, the real YAML and DB) is still unverified until
  the gated OMV run. Budget and RPM/TPM enforcement at runtime is untested.
- **`policies`:** Enterprise-gated in the lab.
- **JWT:** its effect is only detected, not evaluated.
- **Summary revision:** the expected production revision is supplied as an argument. The last ledger
  value is `d54eda2…e852` (R4.5); the PM must confirm the current one.
