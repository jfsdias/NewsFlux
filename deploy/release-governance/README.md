# Summary release evidence and transition rehearsal

The offline validator below is **not a deployment tool**; the executable tool is `release.py` (see the last section). It validates an operator-supplied offline snapshot and exercises an in-memory transition model. It does not authenticate the evidence, inspect Docker, acquire a cross-process lock, verify image revision labels, validate volume sources/permissions or network ACLs, or prove rollback against a real Compose runtime. Those gates remain blocked. In particular, existence of a rollback file is not proof it can be executed.

An evidence bundle contains a manifest JSON, a separately collected `docker compose config --format json` document, and a protected-container identity map. Never publish the effective configuration: it can contain secrets. An operator may validate a private bundle locally with:

```sh
python3 deploy/release-governance/governance.py /private/manifest.json /private/effective.json /private/identities.json
```

The validator checks the approved SHA shape, immutable image IDs, exact ordered list and hashes of at least two Compose files, disabled inference and external transfer, no published Summary port, expected Summary network names and mount targets, the rollback file's existence and expected hash, and equality of supplied protected identities. These checks do not authenticate input or check live state. Full, verified Compose file ordering is operator-provided; no current release path or number of layers is hardcoded.

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s deploy/release-governance -p 'test*.py'
```

The tests simulate promotion and idempotent rollback in memory and in a disposable file, including drift rejection and concurrent cooperative writers sharing a file lock. They do not run Docker, touch real articles, or prove concurrency protection for real deployments. Before a future executable release tool is authorized, add authenticated live inspection, revision label and previous-image checks, file/volume permission and ACL verification, a durable manifest binding rollback files and configuration, cross-process locking and concurrent-change checks, service-scoped execution, and an isolated Docker Compose promotion/rollback rehearsal. Reconcile the resulting rollback with the actual production runtime separately before any intervention.

A separate CI-only Docker rehearsal builds two synthetic images, promotes and restores only the synthetic Summary container, checks the unchanged synthetic Reader container, rejects stale guards, and repeats rollback. It does not run the production release tool (which does not exist), validate the current OMV state, or test host-wide concurrency against non-cooperating writers.

## Executable release tool (`release.py`)

`release.py` is the governed release mechanism for the real runtime. It never runs a generic `docker compose up`:
the only mutation it performs is `docker compose ... up -d --no-deps --no-build --pull never <service>` for one
(project, service) pair listed in `policy.json` (Miniflux, its database and NPM are rejected in code).

```sh
# 1. Read-only evidence (no secrets: environment values are never read or printed)
sudo python3 deploy/release-governance/release.py inspect --project newsflux
# 2. Durable, hashed manifest for an exact image ID whose OCI revision label equals the approved SHA
sudo python3 deploy/release-governance/release.py plan --project newsflux --service summary-api \
  --candidate-image sha256:<64-hex> --approved-sha <40-hex> \
  --protected newsflux --protected miniflux --protected miniflux-db \
  --release-dir /dockerdata/compose/newsflux/.releases/<release-id>
# 3. Promote (auto-rollback on health failure) / 4. Roll back (idempotent, refuses foreign state)
sudo python3 deploy/release-governance/release.py promote --manifest <release-dir>/manifest.json
sudo python3 deploy/release-governance/release.py rollback --manifest <release-dir>/manifest.json
```

- **Compose sequence**: taken from the running container's `com.docker.compose.project.config_files` label, in
  order, and hashed into the manifest. Nothing about R12F-06 (or any release path) is hard-coded. Compose records
  every `-f` file, so after a release the live sequence is "approved base + one release-owned override"; the tool
  accepts that only when the override is byte-identical to what the manifest generates. Recreating the service
  without that last override would silently revert the image — keep it, exactly as with R12F-06.
- **Drift**: Compose/env file hashes, working directory, networks, mounts, published ports and the identity
  (container ID, image ID, config hash) of every `--protected` container are checked before and after.
- **Concurrency**: a host-wide non-blocking `flock` (`/run/lock/newsflux-release.lock`); a second operation fails
  with `CONCURRENT_RELEASE_BLOCKED`.
- **Journal**: `<release-dir>/journal.jsonl` (append-only, fsync'd) plus the read-only `manifest.json`.

`test_release_docker.py` exercises the real tool against a disposable Compose project (`RELEASE_DOCKER_TESTS=1`):
exact-image promotion, forced health failure with automatic restoration, configuration drift, concurrency,
protected-service drift, revision mismatch, unauthorized service, manifest tampering, idempotent rollback and refusal
when the live state no longer matches the release. It never touches a production host. The earlier offline validator
(`governance.py`) is kept for evidence bundles.

## Closeout changes (state model, readiness, exact restoration)

- **State = image ID + recorded Compose sequence.** `CANDIDATE` is `base + approved extra overrides +
candidate.override.json` with the candidate image; `PREVIOUS` is the previous image with the base
  sequence (or base + `rollback.override.json`). Anything else is `FOREIGN` and is never touched.
- **Exact restoration.** At plan time the tool records whether the approved base sequence alone resolves
  to the current image. Rollback re-checks this at execution time (a moved tag never brings up another
  image) and, when true, re-applies the base sequence unchanged and requires the original Compose
  `config-hash` (`PREVIOUS_CONFIG_NOT_RESTORED` otherwise). The Summary API's seven Compose files,
  including the R12F-06 override, are therefore restored byte-for-byte as the live sequence.
- **Readiness.** A missing Docker healthcheck is never readiness. Services without one (the Reader)
  require `--ready-probe` (JSON argv run with `docker exec`, 3 consecutive successes); otherwise
  `READINESS_UNDEFINED` at plan time.
- **Configuration-only releases.** `--extra-override` (hash-pinned) supports policy changes with the same
  image, e.g. enabling S5; `--network-added` declares networks such an override adds. Undeclared network
  changes fail with `NETWORK_DRIFT` and roll back.

`ai-functional-release.sh` separates `prepare` (creates the release dir and exact source) from
`preflight` (strictly read-only, proven by the rehearsal), checks the public catalog fail-closed
(exact status + Summary-API JSON error code through NPM → Caddy → Summary), proves Reader readiness with
an HTTP probe, and offers `s5-preflight` / `enable-s5` / `disable-s5`.

`rehearse-operator-script.sh` runs the operator procedure end to end in a disposable stack with the
production names (`newsflux`, `summary-api`, `miniflux`, `miniflux-db`), two Summary Compose layers, the
old pilot Caddyfile (`6970ee…`) and a TLS front standing in for NPM: 21 gates, including read-only
preflight, preserved layers, fail-closed catalog smoke before the Caddy route exists, exact
image/config-hash restoration, Caddy restoration, idempotent rollback and automatic rollback of a Reader
that does not serve the app.
