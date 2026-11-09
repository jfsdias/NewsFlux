import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"))

const blueprint = readJson("./tests/fixtures/limesurvey-ce-dummy-instrument-blueprint-01.json")
const fieldMap = readJson("./tests/fixtures/limesurvey-ce-export-field-map-01.json")
const allocation = readJson("./tests/fixtures/personalization-pilot-dummy-allocation-01.json")
const receipts = readJson("./tests/fixtures/personalization-pilot-dummy-session-receipts-01.json")
const stimuli = readJson("./tests/fixtures/personalization-pilot-dummy-stimuli-01.json")

const resolveFieldMapReference = (reference) => {
  if (reference === "sessionColumns.studyOnlyPreferenceSeedKeys[].column") {
    return fieldMap.sessionColumns.studyOnlyPreferenceSeedKeys.map(({ column }) => column)
  }

  if (reference.startsWith("sessionColumns.")) {
    const key = reference.slice("sessionColumns.".length)
    return [fieldMap.sessionColumns[key]]
  }

  const match = /^scenarios\[([^\]]+)\]\.columns\.(.+)$/.exec(reference)
  assert.ok(match, `Unsupported blueprint reference: ${reference}`)
  const [, scenarioCode, columnPath] = match
  const scenario = fieldMap.scenarios.find((item) => item.scenarioCode === scenarioCode)
  assert.ok(scenario, `Unknown scenario in blueprint: ${scenarioCode}`)
  let value = scenario.columns
  const pathParts = columnPath.split(".")
  for (const key of pathParts) {
    if (key === "*") {
      break
    }
    value = value[key]
  }

  return typeof value === "string" ? [value] : Object.values(value)
}

const blueprintFieldCodes = () => {
  const groups = blueprint.questionGroups
  const references = [
    ...Object.values(groups.sessionControl.fields),
    groups.profileSeedChoices.fields,
    ...groups.pairedScenarios.flatMap(({ fields }) => Object.values(fields).map((value) => value)),
    ...Object.values(groups.sessionCloseout.fields),
  ]
  return references.flatMap((reference) => resolveFieldMapReference(reference))
}

const expectedFieldCodes = () => [
  fieldMap.sessionColumns.sessionCode,
  fieldMap.sessionColumns.allocationKey,
  fieldMap.sessionColumns.sessionManifestHash,
  fieldMap.sessionColumns.consent,
  ...fieldMap.sessionColumns.studyOnlyPreferenceSeedKeys.map(({ column }) => column),
  ...fieldMap.scenarios.flatMap(({ columns }) => [
    columns.scenarioCode,
    columns.presented,
    columns.pairReceiptHash,
    columns.presentationOrder,
    columns.scenarioPreference,
    ...Object.values(columns.X),
    ...Object.values(columns.Y),
  ]),
  fieldMap.sessionColumns.overallPreference,
  fieldMap.sessionColumns.optionalRationale,
]

test("blueprint is explicitly synthetic and not represented as an importable LimeSurvey file", () => {
  assert.equal(blueprint.artifactKind, "SYNTHETIC_SURVEY_BLUEPRINT_NOT_LSS")
  assert.equal(blueprint.targetSoftware.runtimeImportVerified, false)
  assert.equal(blueprint.importStatus.lssFileIncluded, false)
  assert.equal(blueprint.syntheticFixtureContract.fixtureKind, "SYNTHETIC_ONLY")
  assert.equal(blueprint.safety.humanCollection, false)
  assert.equal(blueprint.safety.realNewsFluxOrMinifluxData, false)
  assert.equal(blueprint.safety.personalizationV2, "HOLD")
})

test("blueprint references the exact versioned field-map question codes once", () => {
  const actual = blueprintFieldCodes()
  const expected = expectedFieldCodes()
  assert.equal(new Set(actual).size, actual.length)
  assert.deepEqual([...actual].toSorted(), [...expected].toSorted())
  assert.equal(fieldMap.contractVersion, blueprint.sourceFieldMap.contractVersion)
})

test("synthetic rehearsal contains four sessions and two paired scenarios per session", () => {
  assert.equal(allocation.fixtureKind, "SYNTHETIC_ONLY")
  assert.equal(receipts.fixtureKind, "SYNTHETIC_ONLY")
  assert.equal(stimuli.fixtureKind, "SYNTHETIC_ONLY")
  assert.equal(allocation.assignments.length, 4)
  assert.equal(receipts.sessionManifests.length, 4)
  assert.equal(stimuli.scenarios.length, 2)
  assert.equal(blueprint.syntheticFixtureContract.sessionCount, 4)
  assert.equal(blueprint.syntheticFixtureContract.scenariosPerSession, 2)
  assert.equal(blueprint.syntheticFixtureContract.armsPerScenario, 2)

  for (const receipt of receipts.sessionManifests) {
    assert.equal(receipt.scenarioPairs.length, 2)
  }
})

test("answer contract preserves omission, cannot-judge, and blinded session mapping", () => {
  assert.deepEqual(blueprint.answerContract.scenarioPreferenceCodes, fieldMap.codes.preference)
  assert.equal(blueprint.answerContract.blankIsNotCannotJudge, true)
  assert.deepEqual(
    blueprint.questionGroups.sessionCloseout.preferenceAnswers,
    fieldMap.codes.preference,
  )
  assert.equal(blueprint.surveyConfiguration.armMappingVisibleToRespondent, false)

  const questionCodes = blueprintFieldCodes().map((code) => code.toLowerCase())
  for (const forbidden of ["email", "participantemail", "ipaddress", "token", "minifluxpassword"]) {
    assert.equal(
      questionCodes.some((code) => code.includes(forbidden)),
      false,
      `Unexpected sensitive question code: ${forbidden}`,
    )
  }
})
