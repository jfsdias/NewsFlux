<!--
Complete every section. Rules and states are defined in docs/qa/QA_CHARTER.md.
A pull request without QA evidence is not ready for review. QA_PASSED never authorizes a merge or a deploy.
-->

## Summary

<!-- One coherent purpose. What changes and why. Link the requirement, finding (for example QA-001) or roadmap item. -->

## QA

### Risk level

<!-- Keep one. R0 docs/tests only · R1 internal logic · R2 UI/layout/CSS/input · R3 state/data/API/auth · R4 platform (PWA, headers, build, CI, dependencies) -->

- [ ] R0
- [ ] R1
- [ ] R2
- [ ] R3
- [ ] R4

### Requirements

<!-- The original requirement and where it is written. If none is approved, say REQUIREMENT_PENDING and link the proposal in docs/qa/proposals/. -->

### Tests (red then green)

<!-- Files added or changed. Paste the failing output BEFORE the change and the passing output AFTER it, on Node 22 and Node 24. -->

- [ ] A regression test fails without the change and passes with it
- [ ] `pnpm test:src` and `pnpm test:scripts` pass on Node 22 and Node 24
- [ ] `pnpm run build`, `pnpm lint`, `pnpm format:check` and `pnpm knip:check` pass
- [ ] No test was deleted or weakened to obtain a green result

### Negative case

<!-- At least one meaningful attempt to break the change: bad input, failure path, other viewport or input mode, and the result. -->

### Environment and evidence type

<!-- Label each result: physical, emulated, synthetic or static. Emulation is not a physical or Safari/WebKit verification. -->

- Node versions:
- Browser and version:
- Viewport / device / pointer type:
- Evidence type (physical · emulated · synthetic · static):

### Evidence

<!-- Commands, logs, screenshots and their paths and SHA-256. -->

### Regressions searched

<!-- Which critical flows and neighboring behaviors were re-checked, and how. -->

### Known limitations

<!-- Anything not verified (no physical device, no real Miniflux, no Safari...). -->

### QA state

<!-- Keep one. The author must not self-certify QA_PASSED: name the independent reviewer, or state that none was available. -->

- [ ] `QA_NOT_STARTED`
- [ ] `QA_IN_PROGRESS`
- [ ] `QA_BLOCKED`
- [ ] `QA_FAILED`
- [ ] `QA_PASSED_WITH_LIMITATIONS`
- [ ] `QA_PASSED`

Independent reviewer:

## Scope checklist

- [ ] One purpose per pull request
- [ ] No feature in HOLD was reactivated or changed (Story ranking/identity, dual-pane reader, offline data...)
- [ ] No breakpoint was changed without evidence, and no device verification is claimed without a device
- [ ] No production setting, secret, deploy permission or branch-protection setting was changed
- [ ] Documentation affected by the change was updated
