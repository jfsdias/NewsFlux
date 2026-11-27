# NEWSFLUX-AI-SETTINGS-01 — PM/Red Team R4.1: update after the handoff, #267 preferred

**Event:** `2026-11-18/NEWSFLUX/R41-PM-PR266-PR267-RECONCILIATION`, America/Bahia.  
**Scope:** independent GitHub analysis, no OMV access, no deploy/merge/inference/real key. Reconcile with the [original handoff](NEWSFLUX_AI_SETTINGS_01_R41_HANDOFF.md), preserving it as history.  
**Main confirmed:** `d54eda2bdb8bc5c3d1bd58d40236f48da762e852`; PRs #260–#267 DRAFT, not merged at the time of review. #260 explicitly HOLD.

## Evidence confirmed by GitHub

- **P0 #265 @ `4c3e07529d706ffc37115aa8de808f36cccdc244`:** the `python -I` preflight adds fixed root `/app` after checking root ownership, non-symlink status, and no group/other write permission on `/app/services` and transitive paths; disables bytecode; post-run audit of the imported `services.*`. Summary's Dockerfile COPY runs under root and `USER 10001:10001`. Before this review, `896d1dc` was followed by two commits that change only preflight/tests, without force push. Exact GitHub Actions: release [44350156006](https://github.com/jfsdias/NewsFlux/actions/runs/44350156006), Quality [44350156064](https://github.com/jfsdias/NewsFlux/actions/runs/44350156064), pilot [44350155988](https://github.com/jfsdias/NewsFlux/actions/runs/44350155988), E2E [44350156502](https://github.com/jfsdias/NewsFlux/actions/runs/44350156502), linter [44350156632](https://github.com/jfsdias/NewsFlux/actions/runs/44350156632): SUCCESS. `OMV_READONLY_PREFLIGHT` remains **not executed**.
- **P1 #266 @ `4143e3c4cc276a40ebef96c034ddae9c73a99c98`:** CI Quality [44351237672](https://github.com/jfsdias/NewsFlux/actions/runs/44351237672) SUCCESS; changes only `services/article_intel_summary/tests/test_api_supervision.py`, fixes the timing of the inference test, but leaves the sibling test `test_timeout_keeps_capacity_until_worker_finishes` without a controlled clock. **REPORTED_AGENT:** a second analysis under CPU+I/O load observed 4/60 failures of that sibling. It is not a PM-reproduced proof.
- **P1 #267 @ `f9926a20c0cbe2a8f2fb5adcc14ced1d38d18a89`:** also changes only the same file, **is a competing alternative**. Code includes a controlled clock in both tests, a latency regression before the adapter, and a negative case for pre-dispatch expiry that requires 504, no gateway send, and an `uncertain` reservation. Exact CI Quality [44354156865](https://github.com/jfsdias/NewsFlux/actions/runs/44354156865), pilot [44354157039](https://github.com/jfsdias/NewsFlux/actions/runs/44354157039), E2E [44354156917](https://github.com/jfsdias/NewsFlux/actions/runs/44354156917), fallback [44354156866](https://github.com/jfsdias/NewsFlux/actions/runs/44354156866), lint [44354156854](https://github.com/jfsdias/NewsFlux/actions/runs/44354156854): SUCCESS. **REPORTED_AGENT:** 0/150 under combined stress (not an independent PM execution).
- **Integration gap:** tree `011c01cf8c8c84b07a0cda056539e062bc645670` has **#266**, not #267; the CI workflow_dispatch release [44351749588](https://github.com/jfsdias/NewsFlux/actions/runs/44351749588), pilot [44351758184](https://github.com/jfsdias/NewsFlux/actions/runs/44351758184), E2E [44351877599](https://github.com/jfsdias/NewsFlux/actions/runs/44351877599), and fallback [44351773281](https://github.com/jfsdias/NewsFlux/actions/runs/44351773281) runs were checked on the GitHub REST API and point to that SHA. The other tree `233214259b122f57e756df4e1e6dec4e4989f846`, which contains #267, incorporates **#265 before `4c3e075`** and does not resolve the final gate. #261 was updated to `cdb56e91288fd7f81286b14c630cf256581e79ab` (current CI green), and its handoff mistakenly recommends #266 before the new finding.
- **PR dependency:** #263 still has `base=codex/newsflux-ai-settings-backend-r1` (stacked on #262). Never merge #263 directly while the retarget/rebase/CI against main is pending. #264 and #261 are independent and need rebase/CI after changes to main.

## Independent PM decision

**`P1_PREFERRED=#267`; `#266=SUPERSEDED_CANDIDATE` only on technical preference, with no automatic closure. `MERGE_READY_CHAIN=HOLD`; `DEPLOY=HOLD`; `OMV_READONLY_PREFLIGHT=NOT_EXECUTED`.** No new P0 is confirmed in the #265 hardening. But **no existing tree proves the final combination**. Do not import the 0/150 stress numbers as statistical proof of the total absence of a race. The conditional merge authorization attributed to the owner in [comment #267](https://github.com/jfsdias/NewsFlux/pull/267#issuecomment-6986801829) is **REPORTED_OWNER_CONDITIONAL_INTENT**; it does not satisfy the technical condition while the gate fails.

**Next single, restricted sprint (no merge or OMV GO):**

1. Prepare a disposable tree **from exact main**, with #267 @ `f9926a2`, #265 @ `4c3e075`, #262 @ `683d60c`, #263 delta against #262 @ `8b7960d`, #264 @ `2641010`, #261 @ `cdb56e9`. **Exclude #266 and #260**. No force push, merging main, deploy, token, or PR changes.
2. Record the exact SHA of the tree and run the release rehearsal, pilot, E2E, and fallback workflows on the **new** SHA; run Quality/lint (and the negative timeout tests) on that same SHA, via GitHub Actions when configured or locally with command/environment evidence. Do not reuse evidence from `011c01c` as if it belonged to the new tree.
3. Demonstrate that #267 did not change product behavior (test-only) or relax deadlines; check the stability of both tests under CPU+I/O stress, without substituting a simple 1× PASS.
4. Jointly review #265's commits from two agents: loss of `-I`, import path, ownership, and possible side effects; keep `UNSAFE_IMPORT_PATH→HOLD`. Confirm that the #260 privacy work, NewsFlux/MiniFlux, the protected NPM proxy hosts, and WallHop are not changed.
5. Prepare a **read-only** OMV preflight with the correct SHA and without `git clone` as root. According to the ledger, `codex-ha` **has no sudo or Docker**, so a separate root execution requires its own decision/GO or a legitimately authorized operator. When done, collect only sanitized lines and FAIL/HOLD without loosening anything.
6. Update #261's documentation with an **addendum** on the #267 preference; record it in both repositories with readback. After final evidence, the PM re-evaluates the merge GO for the sequence **#267 → #265 → #262 → #263 (retarget) → #264 → #261**, with CI per merge and a separate release GO/production.

No execution deviation: no PR merged, closed, or retargeted in this review.

```ini
R41_P0_265=SOURCE_REVIEW_PASS_CI_CONFIRMED
P1_PREFERRED=PR267
P1_PR266=DO_NOT_MERGE_BOTH
P1_STRESS=AGENT_REPORTED_NOT_PM_REPRODUCED
EXACT_FINAL_INTEGRATION=NOT_YET_VERIFIED
OMV_PREFLIGHT=NOT_EXECUTED
OWNER_CONDITIONAL_MERGE_INTENT=REPORTED_NOT_CONSUMED
MERGE_READY_CHAIN=HOLD
DEPLOY=HOLD
PR260=HOLD_UNTOUCHED
NEXT_GATE=R41_FINAL_EXACT_HEAD_INTEGRATION_AND_PREFLIGHT
```
