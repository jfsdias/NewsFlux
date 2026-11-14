# Summary release evidence and transition rehearsal

This draft is **not a deployment tool** and provides no production promotion or rollback command. It validates an operator-supplied offline snapshot and exercises an in-memory transition model. It does not authenticate the evidence, inspect Docker, acquire a cross-process lock, verify image revision labels, validate volume sources/permissions or network ACLs, or prove rollback against a real Compose runtime. Those gates remain blocked. In particular, existence of a rollback file is not proof it can be executed.

An evidence bundle contains a manifest JSON, a separately collected `docker compose config --format json` document, and a protected-container identity map. Never publish the effective configuration: it can contain secrets. An operator may validate a private bundle locally with:

```sh
python3 deploy/release-governance/governance.py /private/manifest.json /private/effective.json /private/identities.json
```

The validator checks the approved SHA shape, immutable image IDs, exact ordered list and hashes of at least two Compose files, disabled inference and external transfer, no published Summary port, expected Summary network names and mount targets, the rollback file's existence and expected hash, and equality of supplied protected identities. These checks do not authenticate input or check live state. Full, verified Compose file ordering is operator-provided; no current release path or number of layers is hardcoded.

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s deploy/release-governance -p 'test*.py'
```

The test simulates promotion and idempotent rollback in memory, including drift rejection. It does not run Docker, touch real articles, or prove host-level concurrency protection. Before a future executable release tool is authorized, add authenticated live inspection, revision label and previous-image checks, file/volume permission and ACL verification, a durable manifest binding rollback files and configuration, cross-process locking and concurrent-change checks, service-scoped execution, and an isolated Docker Compose promotion/rollback rehearsal. Reconcile the resulting rollback with the actual production runtime separately before any intervention.
