import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import {
  createBlindAllocationSchedule,
  createPreRecruitmentManifest,
  createSessionManifest,
  createSyntheticResponse,
  parseStrictJson,
  reconcileSyntheticExport,
  runDummyRehearsalFromFrozenFixtures,
  sha256,
  validateAllocationSchedule,
  validatePreRecruitmentManifest,
  validateSessionManifest,
  validateSyntheticResponse,
} from "./tests/personalization-pilot-dummy-rehearsal-01.js"

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`tests/fixtures/${name}`, import.meta.url), "utf8"))

const stimuli = fixture("personalization-pilot-dummy-stimuli-01.json")
const allocationFixture = fixture("personalization-pilot-dummy-allocation-01.json")
const plan = fixture("personalization-pilot-dummy-session-plan-01.json")

const buildContext = (profileChoices = plan.sessionChoices) => {
  const preRecruitmentManifest = createPreRecruitmentManifest(stimuli)
  const sessionManifests = allocationFixture.assignments.map((allocation) => {
    const choices = profileChoices.find(({ slotIndex }) => slotIndex === allocation.slotIndex)
    return createSessionManifest({
      preRecruitmentManifest,
      allocation,
      profileSeedKeys: choices.profileSeedKeys,
    })
  })
  return { preRecruitmentManifest, sessionManifests }
}

const context = buildContext()
const responseFor = (slotIndex, overrides = {}) => {
  const sessionManifest = context.sessionManifests[slotIndex]
  const responsePlan = plan.responsePlan.find((item) => item.slotIndex === slotIndex)
  return createSyntheticResponse({
    sessionManifest,
    scenarioPreferences: responsePlan.scenarioPreferences,
    overallPreference: responsePlan.overallPreference,
    completionStatus: responsePlan.completionStatus,
    ...overrides,
  })
}

test("strict JSON parser handles valid values and rejects nested and escaped duplicate keys", () => {
  assert.deepEqual(
    { ...parseStrictJson('{"outer":{"a":1},"list":[true,null,"ok"]}') },
    {
      outer: { a: 1 },
      list: [true, null, "ok"],
    },
  )
  assert.throws(
    () => parseStrictJson('{"outer":{"scenario":"one","scenario":"two"}}'),
    (error) => error.code === "DUPLICATE_JSON_KEY",
  )
  assert.throws(
    () => parseStrictJson(String.raw`{"scenarioRatings":{"a":1,"\u0061":2}}`),
    (error) => error.code === "DUPLICATE_JSON_KEY",
  )
  assert.throws(
    () => parseStrictJson('{"ok":true} trailing'),
    (error) => error.code === "INVALID_JSON",
  )
})

test("pre-recruitment manifest is deterministic and covers only the synthetic frozen fixture", () => {
  const first = createPreRecruitmentManifest(stimuli)
  const second = createPreRecruitmentManifest(stimuli)
  assert.equal(first.fixtureKind, "SYNTHETIC_ONLY")
  assert.equal(first.manifestHash, second.manifestHash)
  assert.deepEqual(
    first.scenarios.map(({ scenarioCode }) => scenarioCode),
    ["synthetic_transit", "synthetic_library"],
  )
  assert.equal(first.articleSetHash.length, 64)
  assert.equal(first.articles.length, 16)
  assert.ok(first.articles.every(({ content }) => content.includes("Synthetic-only")))

  const changedContent = structuredClone(first)
  delete changedContent.manifestHash
  changedContent.articles[0].content += " altered after freeze"
  changedContent.manifestHash = sha256(changedContent)
  assert.throws(
    () => validatePreRecruitmentManifest(changedContent),
    (error) => error.code === "PRE_RECRUITMENT_MANIFEST_CONTENT_MISMATCH",
  )
})

test("frozen rehearsal artifacts reproduce the manifest, receipts, export and report", () => {
  const rehearsal = runDummyRehearsalFromFrozenFixtures()
  const sessionReceipts = fixture("personalization-pilot-dummy-session-receipts-01.json")
  const syntheticExport = fixture("personalization-pilot-dummy-export-01.json")
  const report = JSON.parse(
    readFileSync(
      new URL("tests/reports/personalization-pilot-dummy-rehearsal-01.json", import.meta.url),
      "utf8",
    ),
  )

  assert.deepEqual(
    fixture("personalization-pilot-dummy-pre-recruitment-manifest-01.json"),
    rehearsal.preRecruitmentManifest,
  )
  assert.deepEqual(sessionReceipts, {
    fixtureKind: "SYNTHETIC_ONLY",
    sessionManifests: rehearsal.sessionManifests,
  })
  assert.deepEqual(syntheticExport, rehearsal.exportDocument)
  assert.deepEqual(report, rehearsal.report)
})

test("frozen fixture covers algorithm-first and X/Y label-first as independent orders", () => {
  const coverage = allocationFixture.assignments.map(({ presentationOrder, armMapping }) => {
    const algorithmFirst =
      presentationOrder === "PHASE_2C_FIRST" ? "PHASE_2C_DETERMINISTIC" : "PERSONALIZATION_V1"
    const labelFirst = armMapping.X === algorithmFirst ? "X" : "Y"
    return `${algorithmFirst}|${labelFirst}`
  })

  assert.deepEqual(coverage.toSorted(), [
    "PERSONALIZATION_V1|X",
    "PERSONALIZATION_V1|Y",
    "PHASE_2C_DETERMINISTIC|X",
    "PHASE_2C_DETERMINISTIC|Y",
  ])

  for (const [slotIndex, sessionManifest] of context.sessionManifests.entries()) {
    const expectedLabelOrder = coverage[slotIndex].endsWith("|X") ? "X_THEN_Y" : "Y_THEN_X"
    assert.equal(sessionManifest.labelPresentationOrder, expectedLabelOrder)
    assert.ok(
      sessionManifest.scenarioPairs.every(
        ({ presentationOrder }) => presentationOrder === expectedLabelOrder,
      ),
    )

    if (expectedLabelOrder === "Y_THEN_X") {
      const response = responseFor(slotIndex)
      assert.doesNotThrow(() =>
        validateSyntheticResponse({
          response,
          sessionManifest,
          preRecruitmentManifest: context.preRecruitmentManifest,
          allocation: allocationFixture.assignments[slotIndex],
        }),
      )
    }
  }
})

test("blind allocation uses cryptographic defaults and counterbalances each four-slot block", () => {
  const generated = createBlindAllocationSchedule({ sessionCount: 4 })
  const orders = generated.map(({ presentationOrder }) => presentationOrder)
  assert.equal(new Set(generated.map(({ sessionCode }) => sessionCode)).size, 4)
  assert.equal(new Set(generated.map(({ allocationKey }) => allocationKey)).size, 4)
  assert.equal(orders.filter((order) => order === "PHASE_2C_FIRST").length, 2)
  assert.equal(orders.filter((order) => order === "V1_FIRST").length, 2)
  for (const assignment of generated) {
    assert.deepEqual(Object.keys(assignment.armMapping).toSorted(), ["X", "Y"])
    assert.notEqual(assignment.armMapping.X, assignment.armMapping.Y)
  }
  assert.throws(
    () => validateAllocationSchedule(generated.toReversed()),
    (error) => error.code === "ALLOCATION_SLOT_ORDER_MISMATCH",
  )
})

test("fixed random fixtures reproduce a valid allocation without reading profile choices", () => {
  let byteCounter = 1
  let intCounter = 0
  const dependencies = {
    sessionCount: 4,
    randomBytesImpl: (size) => Buffer.alloc(size, byteCounter++),
    randomIntImpl: (upperBound) => intCounter++ % upperBound,
  }
  const first = createBlindAllocationSchedule(dependencies)
  byteCounter = 1
  intCounter = 0
  const second = createBlindAllocationSchedule({ ...dependencies, profileChoices: ["ignored"] })
  assert.deepEqual(first, second)
  assert.equal(
    first.filter(({ presentationOrder }) => presentationOrder === "PHASE_2C_FIRST").length,
    2,
  )
  assert.equal(first.filter(({ presentationOrder }) => presentationOrder === "V1_FIRST").length, 2)
})

test("allocation generator supports all four joint algorithm and label orders", () => {
  let byteCounter = 1
  const randomDraws = [2, 2, 0, 0, 1, 1, 0]
  const generated = createBlindAllocationSchedule({
    sessionCount: 4,
    randomBytesImpl: (size) => Buffer.alloc(size, byteCounter++),
    randomIntImpl: (upperBound) => {
      const value = randomDraws.shift()
      assert.ok(value < upperBound)
      return value
    },
  })
  const combinations = generated.map(({ presentationOrder, armMapping }) => {
    const algorithmFirst =
      presentationOrder === "PHASE_2C_FIRST" ? "PHASE_2C_DETERMINISTIC" : "PERSONALIZATION_V1"
    const labelFirst = armMapping.X === algorithmFirst ? "X" : "Y"
    return `${algorithmFirst}|${labelFirst}`
  })

  assert.deepEqual(combinations.toSorted(), [
    "PERSONALIZATION_V1|X",
    "PERSONALIZATION_V1|Y",
    "PHASE_2C_DETERMINISTIC|X",
    "PHASE_2C_DETERMINISTIC|Y",
  ])
  assert.equal(randomDraws.length, 0)
})

test("session receipts use production Home projections and freeze both arm compositions", () => {
  for (const sessionManifest of context.sessionManifests) {
    validateSessionManifest({
      manifest: sessionManifest,
      frozenManifest: sessionManifest,
      preRecruitmentManifest: context.preRecruitmentManifest,
      allocation: allocationFixture.assignments[sessionManifest.slotIndex],
    })
    assert.equal(sessionManifest.sessionManifestHash.length, 64)
    assert.equal(sessionManifest.rendererRevision, stimuli.rendererRevision)
    assert.deepEqual(
      sessionManifest.profileSeedReferences.keys,
      plan.sessionChoices[sessionManifest.slotIndex].profileSeedKeys,
    )
    for (const pair of sessionManifest.scenarioPairs) {
      const expectedIds = pair.eligibleArticleIds.map(String).toSorted()
      for (const arm of Object.values(pair.arms)) {
        assert.equal(new Set(arm.articleIds.map(String)).size, expectedIds.length)
        assert.deepEqual(arm.articleIds.map(String).toSorted(), expectedIds)
        assert.deepEqual(arm.readerOrderIds, arm.articleIds)
        assert.equal(arm.articleMetadata.length, expectedIds.length)
      }
      assert.notEqual(pair.pairReceiptHash, undefined)
      assert.ok(pair.arms.X.algorithmRevision)
      assert.ok(pair.arms.Y.algorithmRevision)
    }
  }
  assert.throws(
    () => context.sessionManifests[0].scenarioPairs[0].arms.X.articleIds.push(999_999),
    TypeError,
  )
})

test("assignment and X/Y mapping remain independent when synthetic profile choices change", () => {
  const changedChoices = plan.sessionChoices.map((choice) => ({
    ...choice,
    profileSeedKeys: ["synthetic-favorite-community"],
  }))
  const changedContext = buildContext(changedChoices)
  assert.deepEqual(
    context.sessionManifests.map(
      ({ sessionCode, allocationKey, armMapping, presentationOrder }) => ({
        sessionCode,
        allocationKey,
        armMapping,
        presentationOrder,
      }),
    ),
    changedContext.sessionManifests.map(
      ({ sessionCode, allocationKey, armMapping, presentationOrder }) => ({
        sessionCode,
        allocationKey,
        armMapping,
        presentationOrder,
      }),
    ),
  )
  assert.notDeepEqual(
    context.sessionManifests.map(({ scenarioPairs }) =>
      scenarioPairs.map(({ arms }) => arms.Y.articleIds),
    ),
    changedContext.sessionManifests.map(({ scenarioPairs }) =>
      scenarioPairs.map(({ arms }) => arms.Y.articleIds),
    ),
  )
})

test("session hash, pair receipt, schedule, composition and profile references reject post-freeze edits", () => {
  const original = context.sessionManifests[0]
  const allocation = allocationFixture.assignments[0]
  const validate = (candidate) =>
    validateSessionManifest({
      manifest: candidate,
      frozenManifest: original,
      preRecruitmentManifest: context.preRecruitmentManifest,
      allocation,
    })

  const sessionHashTamper = structuredClone(original)
  sessionHashTamper.sessionManifestHash = "0".repeat(64)
  assert.throws(
    () => validate(sessionHashTamper),
    (error) => error.code === "SESSION_HASH_MISMATCH",
  )

  const pairHashTamper = structuredClone(original)
  pairHashTamper.scenarioPairs[0].pairReceiptHash = "0".repeat(64)
  assert.throws(
    () => validate(pairHashTamper),
    (error) => error.code === "PAIR_HASH_MISMATCH",
  )

  const compositionTamper = structuredClone(original)
  const tamperedArm = compositionTamper.scenarioPairs[0].arms.X
  ;[tamperedArm.highlightIds[0], tamperedArm.highlightIds[1]] = [
    tamperedArm.highlightIds[1],
    tamperedArm.highlightIds[0],
  ]
  ;[tamperedArm.articleIds[0], tamperedArm.articleIds[1]] = [
    tamperedArm.articleIds[1],
    tamperedArm.articleIds[0],
  ]
  ;[tamperedArm.readerOrderIds[0], tamperedArm.readerOrderIds[1]] = [
    tamperedArm.readerOrderIds[1],
    tamperedArm.readerOrderIds[0],
  ]
  ;[tamperedArm.articleMetadata[0], tamperedArm.articleMetadata[1]] = [
    tamperedArm.articleMetadata[1],
    tamperedArm.articleMetadata[0],
  ]
  assert.throws(
    () => validate(compositionTamper),
    (error) => error.code === "COMPOSITION_CHANGED_AFTER_FREEZE",
  )

  const duplicateArticle = structuredClone(original)
  duplicateArticle.scenarioPairs[0].arms.X.articleIds[0] =
    duplicateArticle.scenarioPairs[0].arms.X.articleIds[1]
  assert.throws(
    () => validate(duplicateArticle),
    (error) => error.code === "ARTICLE_DUPLICATE",
  )

  const missingArticle = structuredClone(original)
  missingArticle.scenarioPairs[0].arms.Y.articleIds.pop()
  assert.throws(
    () => validate(missingArticle),
    (error) => error.code === "ARTICLE_COVERAGE_MISMATCH",
  )

  const changedProfile = structuredClone(original)
  changedProfile.profileSeedReferences.keys = ["synthetic-favorite-local"]
  assert.throws(
    () => validate(changedProfile),
    (error) => error.code === "PROFILE_PREFERENCES_CHANGED",
  )

  const invertedMapping = structuredClone(original)
  invertedMapping.armMapping = { X: "PERSONALIZATION_V1", Y: "PHASE_2C_DETERMINISTIC" }
  assert.throws(
    () => validate(invertedMapping),
    (error) => error.code === "ALLOCATION_MAPPING_MISMATCH",
  )

  const changedOrder = structuredClone(original)
  changedOrder.presentationOrder = "V1_FIRST"
  assert.throws(
    () => validate(changedOrder),
    (error) => error.code === "PRESENTATION_ORDER_MISMATCH",
  )
})

test("responses pass Draft 2020-12 and preserve omitted versus explicit CANNOT_JUDGE", () => {
  const response = responseFor(0)
  validateSyntheticResponse({
    response,
    sessionManifest: context.sessionManifests[0],
    preRecruitmentManifest: context.preRecruitmentManifest,
    allocation: allocationFixture.assignments[0],
  })
  assert.equal(response.scenarioRatings.synthetic_transit.scenarioPreference, "X")
  assert.equal(response.scenarioRatings.synthetic_library.scenarioPreference, "CANNOT_JUDGE")

  const omitted = responseFor(1)
  assert.equal(omitted.scenarioRatings.synthetic_transit.scenarioPreference, null)
  assert.equal(omitted.scenarioRatings.synthetic_library.scenarioPreference, "TIE")
  validateSyntheticResponse({
    response: omitted,
    sessionManifest: context.sessionManifests[1],
    preRecruitmentManifest: context.preRecruitmentManifest,
    allocation: allocationFixture.assignments[1],
  })
})

test("response validation rejects schema enums, unknown IDs, missing complete scenarios and invalid partial extras", () => {
  const response = responseFor(0)
  const base = {
    sessionManifest: context.sessionManifests[0],
    preRecruitmentManifest: context.preRecruitmentManifest,
    allocation: allocationFixture.assignments[0],
  }

  const invalidEnum = structuredClone(response)
  invalidEnum.scenarioRatings.synthetic_transit.scenarioPreference = "MAYBE"
  assert.throws(
    () => validateSyntheticResponse({ ...base, response: invalidEnum }),
    (error) => error.code === "ENUM_INVALID",
  )

  const unknownScenario = structuredClone(response)
  unknownScenario.scenarioRatings.synthetic_unknown = {
    ...unknownScenario.scenarioRatings.synthetic_transit,
  }
  assert.throws(
    () => validateSyntheticResponse({ ...base, response: unknownScenario }),
    (error) => error.code === "SCENARIO_UNKNOWN",
  )

  const missingComplete = structuredClone(response)
  delete missingComplete.scenarioRatings.synthetic_library
  assert.throws(
    () => validateSyntheticResponse({ ...base, response: missingComplete }),
    (error) => error.code === "COMPLETE_SCENARIO_SET_MISMATCH",
  )

  const partialReceipt = createSessionManifest({
    preRecruitmentManifest: context.preRecruitmentManifest,
    allocation: allocationFixture.assignments[0],
    profileSeedKeys: [],
    scenarioCodes: ["synthetic_transit"],
  })
  const partial = createSyntheticResponse({
    sessionManifest: partialReceipt,
    completionStatus: "PARTIAL",
    scenarioPreferences: { synthetic_transit: null },
    overallPreference: null,
  })
  assert.doesNotThrow(() =>
    validateSyntheticResponse({
      response: partial,
      sessionManifest: partialReceipt,
      preRecruitmentManifest: context.preRecruitmentManifest,
      allocation: allocationFixture.assignments[0],
    }),
  )
  partial.scenarioRatings.synthetic_library = { ...partial.scenarioRatings.synthetic_transit }
  assert.throws(
    () =>
      validateSyntheticResponse({
        response: partial,
        sessionManifest: partialReceipt,
        preRecruitmentManifest: context.preRecruitmentManifest,
        allocation: allocationFixture.assignments[0],
      }),
    (error) => error.code === "SCENARIO_NOT_SCHEDULED",
  )
})

test("response validation binds session, allocation, pair hash and presentation order", () => {
  const response = responseFor(0)
  const base = {
    sessionManifest: context.sessionManifests[0],
    preRecruitmentManifest: context.preRecruitmentManifest,
    allocation: allocationFixture.assignments[0],
  }

  const wrongSession = responseFor(1)
  assert.throws(
    () => validateSyntheticResponse({ ...base, response: wrongSession }),
    (error) => error.code === "SESSION_MANIFEST_MISMATCH",
  )

  const wrongAllocation = structuredClone(response)
  wrongAllocation.allocationKey = allocationFixture.assignments[1].allocationKey
  assert.throws(
    () => validateSyntheticResponse({ ...base, response: wrongAllocation }),
    (error) => error.code === "ALLOCATION_KEY_MISMATCH",
  )

  const wrongPair = structuredClone(response)
  wrongPair.scenarioRatings.synthetic_transit.pairReceiptHash = "0".repeat(64)
  assert.throws(
    () => validateSyntheticResponse({ ...base, response: wrongPair }),
    (error) => error.code === "PAIR_RECEIPT_HASH_MISMATCH",
  )

  const wrongOrder = structuredClone(response)
  wrongOrder.scenarioRatings.synthetic_transit.presentationOrder =
    wrongOrder.scenarioRatings.synthetic_transit.presentationOrder === "X_THEN_Y"
      ? "Y_THEN_X"
      : "X_THEN_Y"
  assert.throws(
    () => validateSyntheticResponse({ ...base, response: wrongOrder }),
    (error) => error.code === "PRESENTATION_ORDER_MISMATCH",
  )
})

test("reconciliation preserves unique allocations and reports deterministic valid/rejected counts", () => {
  const responses = context.sessionManifests.map((sessionManifest, slotIndex) => {
    const response = responseFor(slotIndex)
    if (plan.responsePlan[slotIndex].tamper === "PAIR_RECEIPT_HASH") {
      response.scenarioRatings.synthetic_transit.pairReceiptHash = "0".repeat(64)
    }
    return response
  })
  const rawExportText = JSON.stringify({ fixtureKind: "SYNTHETIC_ONLY", responses })
  const report = reconcileSyntheticExport({
    rawExportText,
    sessionManifests: context.sessionManifests,
    allocations: allocationFixture.assignments,
    preRecruitmentManifest: context.preRecruitmentManifest,
  })
  assert.equal(report.sessionCount, 4)
  assert.equal(report.validResponseCount, 3)
  assert.equal(report.rejectedResponseCount, 1)
  assert.deepEqual(report.rejectionReasons, { PAIR_RECEIPT_HASH_MISMATCH: 1 })
  assert.equal(report.submittedPairCount, 8)
  assert.equal(report.acceptedPairCount, 6)
  assert.deepEqual(report.algorithmOrderBalance, { PHASE_2C_FIRST: 2, V1_FIRST: 2 })
  assert.deepEqual(report.labelOrderBalance, { X_THEN_Y: 2, Y_THEN_X: 2 })
  assert.deepEqual(report.jointOrderCoverage, {
    "PHASE_2C_FIRST|X_THEN_Y": 1,
    "PHASE_2C_FIRST|Y_THEN_X": 1,
    "V1_FIRST|X_THEN_Y": 1,
    "V1_FIRST|Y_THEN_X": 1,
  })
  assert.equal(report.assignmentMappingLeakedToResponseExport, false)
  assert.equal(report.sessionHashesVerified, 4)
  assert.equal(report.pairHashesVerified, 8)
  assert.equal(report.humanRelevanceMeasured, false)
})

test("reconciliation rejects allocation reuse with a specific code", () => {
  const first = responseFor(0)
  const second = responseFor(1)
  second.allocationKey = first.allocationKey
  const report = reconcileSyntheticExport({
    rawExportText: JSON.stringify({ fixtureKind: "SYNTHETIC_ONLY", responses: [first, second] }),
    sessionManifests: context.sessionManifests,
    allocations: allocationFixture.assignments,
    preRecruitmentManifest: context.preRecruitmentManifest,
  })
  assert.equal(report.validResponseCount, 1)
  assert.equal(report.rejectedResponseCount, 1)
  assert.deepEqual(report.rejectionReasons, { ALLOCATION_KEY_REUSED: 1 })
})

test("secure parser detects duplicate export keys before response validation", () => {
  let error
  assert.throws(
    () => {
      try {
        reconcileSyntheticExport({
          rawExportText: '{"responses":[{"sessionCode":"a","sessionCode":"b"}]}',
          sessionManifests: context.sessionManifests,
          allocations: allocationFixture.assignments,
          preRecruitmentManifest: context.preRecruitmentManifest,
        })
      } catch (error_) {
        error = error_
        throw error_
      }
    },
    (error_) => error_.code === "DUPLICATE_JSON_KEY",
  )
  assert.equal(error.code, "DUPLICATE_JSON_KEY")
})
