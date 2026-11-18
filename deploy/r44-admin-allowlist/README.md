# R4.4B — Summary admin allowlist remediation (operator tooling)

Operator-only tooling for NEWSFLUX-AI-SETTINGS-01. It sets `NEWSFLUX_AI_MINIFLUX_ADMIN_USER_IDS` for the
running Summary on the OMV, after the owner's identity is proven and the owner gives a specific GO. It is
not application code and not a release.

| File                        | Purpose                                                                                                                                                        |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `r44_admin_allowlist.py`    | `audit` and `identity` (read-only), `apply` and `rollback` (mutating, owner-confirmed). Contract in the module docstring.                                      |
| `r44b-readonly-ab.sh`       | The single read-only command for Gates A/B: pinned commit and SHA-256, audit first, the key is requested only after runtime trust passes, aggregate exit code. |
| `r44d-preflight-receipt.sh` | Gate D: the pinned #265 preflight (`4c3e075`) with protected statuses read from real lines and WallHop digest comparison.                                      |
| `tests/`                    | Disposable topology (real Summary image, fake Miniflux over HTTPS, protected stand-ins, canaries) and the RED/GREEN matrices. Never a real host.               |

Safety properties tested:

- **Rollback boundary.** Every step from the first write of the env file to the last post-check runs inside
  the rollback guard. A failure after `os.replace` (for example the directory `fsync`) restores the exact
  bytes, mode and owner and verifies the original config hash. If the restore cannot be proven durable, the
  result is `ROLLBACK_INCOMPLETE`, exit 6, never success.
- **Fail-closed inventory.** Any container that cannot be inspected makes the host snapshot incomplete. This
  holds before any key is requested and before any write.
- **Runtime trust before the secret.** The Summary must be the pinned image ID with the approved revision
  label. `docker diff` must show no drift outside mounts, `/data` and `/tmp`. Every loaded `.py` file in
  `services/article_intel_auth`, `services/content_fallback` and `services/__init__.py` must hash identical
  to the approved revision. Only then is the key read, at a hidden prompt, and passed on stdin.
- **Explicit consent and minimal data.** `/v1/users` is read only after the owner types `LIST-ADMIN-IDS`, and
  only admin IDs are returned. Multiple admins or a declined enumeration yield `OWNER_DECISION_REQUIRED`
  (exit 4), never an inferred choice.
- **Output schema.** Keys come from an explicit list, and values match `[A-Za-z0-9_.:,+-]{0,96}`. Paths
  appear only as 12-hex fingerprints; anything else is suppressed and HOLDs. The outer command filters with
  the same value contract and fails on any non-conforming line or stderr output.

Run the tests (Docker required):

```bash
bash deploy/r44-admin-allowlist/tests/build-test-image.sh "$PWD"
R44_TOOL=deploy/r44-admin-allowlist/r44_admin_allowlist.py bash deploy/r44-admin-allowlist/tests/matrix.sh
bash deploy/r44-admin-allowlist/tests/wrapper-test.sh
bash deploy/r44-admin-allowlist/tests/r44d-wrapper-test.sh
```

Passing tests on a disposable topology do not prove anything about the production state. That comes only
from the real read-only receipt on the OMV.
