# Services

Product backends that ship with the NewsFlux reader. They are owned by the product, versioned with
`src/`, and gated by the product CI (`quality.yaml`, `ai-settings-tests.yaml`,
`article-intel-fallback-tests.yaml`, `story-candidate-ranking.yml`, `content-fallback-image.yaml`).

| Package                 | Role                                                            |
| ----------------------- | --------------------------------------------------------------- |
| `article_intel_auth`    | Shared authentication and origin checks for the AI services.    |
| `article_intel_summary` | Article summary API, admin settings, budget and cost ledgers.   |
| `content_fallback`      | Content fallback reader bridge and its egress-restricted relay. |
| `story_ranker`          | Story candidate ranking.                                        |

Rules:

- Each package keeps its own `tests/`; run them the way CI does (`python -m unittest discover -s
services/<package>/tests -p 'test_*.py'`).
- Services must not import from `ops/`, `research/`, `tests/aux/` or `archive/`.
- Operator tooling that deploys or audits these services lives in `ops/deploy/`, not here. A service
  may name an `ops/` path in documentation or in a frozen contract string, never in an import.
