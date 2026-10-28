# Neutral graph DEV review preparation

Verify the immutable source artifacts and unannotated source state. The sidecar is hash-checked only and is not parsed. Freeze the deterministic session contract before computing the blind order. Assign new sequential reviewer IDs, generate a neutral CSV and a separate private identity map, and verify the result independently. The reviewer receives only feed, title, publication time, options and blank decision fields.

The session parent holds the private contract, map and manifest. Only its `reviewer/` subdirectory is served: it contains the page, neutral CSV and guide. Never serve the parent directory. For the subsequent human-only session, from that reviewer directory run:

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

Open `http://127.0.0.1:8765/` manually. Do not silently select another port. No human review or decision occurs during preparation.

The page uses no remote assets or API. It stores only reviewer IDs and decisions in origin-scoped localStorage under a key derived from the contract and neutral CSV hashes. Completed export requires all decisions; checkpoint export is explicitly named. Imports verify IDs, labels and all neutral article metadata before replacing saved decisions. Reset requires confirmation.

Canonical private artifacts are written atomically, hash-verified, made read-only and rehashed. Two independent runs must produce identical contract, reviewer CSV, identity map, guide, page and manifest bytes. Human-label files remain prohibited, and the private identity map must never enter the served directory.
