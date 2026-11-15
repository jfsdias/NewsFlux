# Settings UX: Summary language and fallback row (PR #250)

Evidence for the visual-only PR #250, reconciled with `main` after #248 (dynamic catalog) and #249
(primary/fallback). Every image here was captured from the reconciled tree. Older images from the
pre-#248 tree were removed.

**Harness:** `scripts/tests/settings-ai-ux.html` renders the real settings modal (`AccessibleModal`,
`SettingsTabs`, `AdaptiveScrollArea`) with a synthetic catalog **schema v2**:

- S5 (LiteLLM, free, available);
- Mistral Small (Mistral, paid, available);
- one gateway model awaiting operator approval.

`?fallback=mistral-small` starts with that fallback enabled; without it the fallback is off.

**Gate:** `reader-ai-e2e/settings-ux.spec.js`, run in the AI-enabled step of "Article Intelligence
Reader Chromium scenarios".

| Image                             | What it shows                                                                 |
| --------------------------------- | ----------------------------------------------------------------------------- |
| `before-fold-884.png`             | `main` before the fix: list cut by the modal, value truncated, "t\|he" split  |
| `before-desktop-1440.png`         | Same at 1440 × 900                                                            |
| `before-fallback-row-820.png`     | `main` before the fix: fallback on, row title squeezed to one letter per line |
| `after-*.png` (5 viewports, dark) | Language list outside the modal, within the screen, long names wrap           |
| `after-fallback-row-820.png`      | Fallback row: switch, list and consents stacked; title column readable        |
| `ai-controls-*.png`               | Primary, fallback and consent controls present and unchanged                  |

**Limits:**

- Viewports and touch are **emulated** in Chromium.
- This is not a check on a physical device, and not a WebKit or iOS Safari check.
- `REAL_DEVICE_GATE=PENDING`.
