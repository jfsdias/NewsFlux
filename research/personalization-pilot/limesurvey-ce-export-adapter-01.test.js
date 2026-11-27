import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import {
  buildMockLimeSurveyCsv,
  importLimeSurveyMockCsv,
  LimeSurveyCsvAdapterError,
  parseLimeSurveyCsv,
} from "./tests/limesurvey-ce-export-adapter-01.js"
import {
  createPreRecruitmentManifest,
  createSessionManifest,
  parseStrictJson,
  validateAllocationSchedule,
} from "./tests/personalization-pilot-dummy-rehearsal-01.js"

const readJson = (filename) =>
  parseStrictJson(readFileSync(new URL(`tests/fixtures/${filename}`, import.meta.url), "utf8"))

const stimuli = readJson("personalization-pilot-dummy-stimuli-01.json")
const allocations = readJson("personalization-pilot-dummy-allocation-01.json").assignments
const choices = readJson("personalization-pilot-dummy-session-plan-01.json").sessionChoices
const fieldMap = readJson("limesurvey-ce-export-field-map-01.json")
const preRecruitmentManifest = createPreRecruitmentManifest(stimuli)
const sessionManifests = allocations.map((allocation) =>
  createSessionManifest({
    preRecruitmentManifest,
    allocation,
    profileSeedKeys: choices.find(({ slotIndex }) => slotIndex === allocation.slotIndex)
      .profileSeedKeys,
  }),
)
const responseFixture = readJson("personalization-pilot-dummy-export-01.json").responses

const context = { fieldMap, sessionManifests, allocations, preRecruitmentManifest }

test("MOCK_CSV_CONTRACT converts to strict schema and manifest-valid response rows", () => {
  const csvText = buildMockLimeSurveyCsv({ responses: responseFixture.slice(0, 3), fieldMap })
  const result = importLimeSurveyMockCsv({ csvText, ...context })

  assert.equal(result.sourceKind, "MOCK_CSV_CONTRACT")
  assert.equal(result.report.limeSurveyIntegrationGate, "NOT_TESTED")
  assert.equal(result.report.humanRelevanceMeasured, false)
  assert.equal(result.report.validResponseCount, 3)
  assert.equal(result.report.rejectedResponseCount, 0)
  assert.equal(result.responses[1].scenarioRatings.synthetic_transit.presentationOrder, "Y_THEN_X")
  assert.equal(result.responses[1].scenarioRatings.synthetic_transit.scenarioPreference, null)
  assert.equal(
    result.responses[0].scenarioRatings.synthetic_library.scenarioPreference,
    "CANNOT_JUDGE",
  )
  assert.equal(Object.hasOwn(result.responses[0], "armMapping"), false)
})

test("CSV parser handles UTF-8 BOM, quoted delimiter, escaped quotes, and embedded newlines", () => {
  const quote = String.fromCodePoint(34)
  const input = `\uFEFFcode,note\r\nA,${quote}line one, ${quote}${quote}quoted${quote}${quote}\r\nline two${quote}\r\n`
  const rows = parseLimeSurveyCsv({
    input: Buffer.from(input, "utf8"),
    delimiter: ",",
  })
  assert.deepEqual(rows, [
    ["code", "note"],
    ["A", 'line one, "quoted"\r\nline two'],
  ])
})

test("configured semicolon and tab separators are parsed without heuristic detection", () => {
  assert.deepEqual(parseLimeSurveyCsv({ input: "code;value\nA;1", delimiter: ";" }), [
    ["code", "value"],
    ["A", "1"],
  ])
  assert.deepEqual(parseLimeSurveyCsv({ input: "code\tvalue\nA\t1", delimiter: "\t" }), [
    ["code", "value"],
    ["A", "1"],
  ])
  for (const delimiter of [";", "\t"]) {
    const configuredMap = {
      ...fieldMap,
      exportMode: { ...fieldMap.exportMode, delimiter },
    }
    const csvText = buildMockLimeSurveyCsv({
      responses: responseFixture.slice(0, 1),
      fieldMap: configuredMap,
    })
    assert.equal(
      importLimeSurveyMockCsv({ csvText, ...context, fieldMap: configuredMap }).report
        .validResponseCount,
      1,
    )
  }
})

test("CSV parser rejects invalid UTF-8 and malformed quoting with safe codes", () => {
  assert.throws(
    () => parseLimeSurveyCsv({ input: Buffer.from([0xc3, 0x28]), delimiter: "," }),
    (error) => error.code === "CSV_UTF8_INVALID",
  )
  assert.throws(
    () => parseLimeSurveyCsv({ input: 'a,b\n1,"unterminated', delimiter: "," }),
    (error) => error.code === "CSV_QUOTE_INVALID",
  )
  assert.throws(
    () => parseLimeSurveyCsv({ input: "a,b\n1,2\n3", delimiter: "," }),
    (error) => error.code === "CSV_ROW_WIDTH_MISMATCH",
  )
})

test("adapter rejects duplicate, missing, blank, or unknown headers", () => {
  const csvText = buildMockLimeSurveyCsv({ responses: responseFixture.slice(0, 1), fieldMap })
  const [header, ...rows] = csvText.split("\r\n")
  const cells = header.split(",")
  const duplicate = `${[...cells, cells[0]].join(",")}\r\n${rows[0]},x`
  const missing = [
    cells.filter((cell) => cell !== fieldMap.sessionColumns.sessionCode).join(","),
    rows[0],
  ].join("\r\n")
  const unknown = [`${header},unexpected`, `${rows[0]},value`].join("\r\n")
  const blank = [`${header},`, `${rows[0]},`].join("\r\n")

  for (const [text, code] of [
    [duplicate, "CSV_HEADER_DUPLICATE"],
    [missing, "CSV_HEADER_MISSING"],
    [unknown, "CSV_HEADER_UNKNOWN"],
    [blank, "CSV_HEADER_BLANK"],
  ]) {
    assert.throws(
      () => importLimeSurveyMockCsv({ csvText: text, ...context }),
      (error) => error.code === code,
    )
  }
})

test("adapter maps only explicitly configured MOCK_CSV_CONTRACT formats", () => {
  const csvText = buildMockLimeSurveyCsv({ responses: responseFixture.slice(0, 1), fieldMap })
  assert.throws(
    () =>
      importLimeSurveyMockCsv({
        csvText,
        ...context,
        fieldMap: { ...fieldMap, fixtureKind: "LIMESURVEY_REAL_EXPORT" },
      }),
    (error) => error.code === "CSV_FORMAT_UNRECOGNIZED",
  )
})

test("V1 system column allowlist rejects unapproved and duplicate fields", () => {
  const csvText = buildMockLimeSurveyCsv({ responses: responseFixture.slice(0, 1), fieldMap })
  assert.equal(importLimeSurveyMockCsv({ csvText, ...context }).report.validResponseCount, 1)

  for (const column of ["token", "email", "unexpected_system_field"]) {
    const changedFieldMap = {
      ...fieldMap,
      systemColumns: {
        ...fieldMap.systemColumns,
        allowedIgnored: [...fieldMap.systemColumns.allowedIgnored, column],
      },
    }
    assert.throws(
      () => importLimeSurveyMockCsv({ csvText, ...context, fieldMap: changedFieldMap }),
      (error) => error.code === "CSV_SYSTEM_COLUMN_UNAPPROVED",
    )
  }

  assert.throws(
    () =>
      importLimeSurveyMockCsv({
        csvText,
        ...context,
        fieldMap: {
          ...fieldMap,
          systemColumns: { ...fieldMap.systemColumns, submittedAt: "email" },
        },
      }),
    (error) => error.code === "CSV_SYSTEM_COLUMN_UNAPPROVED",
  )

  const duplicateFieldMap = {
    ...fieldMap,
    systemColumns: {
      ...fieldMap.systemColumns,
      allowedIgnored: [...fieldMap.systemColumns.allowedIgnored, "id"],
    },
  }
  assert.throws(
    () => importLimeSurveyMockCsv({ csvText, ...context, fieldMap: duplicateFieldMap }),
    (error) => error.code === "CSV_SYSTEM_COLUMN_DUPLICATE",
  )

  assert.deepEqual(fieldMap.systemColumns.allowedIgnored, [
    "id",
    "lastpage",
    "startlanguage",
    "seed",
  ])
})

test("V1 pins submitdate and rejects ignored columns as completion markers", () => {
  const partialResponse = structuredClone(responseFixture[0])
  partialResponse.completionStatus = "PARTIAL"
  const correctCsv = buildMockLimeSurveyCsv({ responses: [partialResponse], fieldMap })
  const records = parseLimeSurveyCsv({ input: correctCsv, delimiter: "," })
  const submitDateIndex = records[0].indexOf(fieldMap.systemColumns.submittedAt)
  assert.notEqual(submitDateIndex, -1)

  const remappedCsv = records
    .map((row) => row.filter((_, index) => index !== submitDateIndex))
    .map((row) => row.join(","))
    .join("\r\n")

  for (const submittedAt of fieldMap.systemColumns.allowedIgnored) {
    const remappedFieldMap = {
      ...fieldMap,
      systemColumns: {
        submittedAt,
        allowedIgnored: fieldMap.systemColumns.allowedIgnored.filter(
          (column) => column !== submittedAt,
        ),
      },
    }
    assert.throws(
      () =>
        importLimeSurveyMockCsv({
          csvText: remappedCsv,
          ...context,
          fieldMap: remappedFieldMap,
        }),
      (error) => error.code === "CSV_SYSTEM_COLUMN_UNAPPROVED",
    )
  }
})

test("scenario identity, receipt hash, visible order, and session join are fail-closed", () => {
  const csvText = buildMockLimeSurveyCsv({ responses: responseFixture.slice(0, 1), fieldMap })
  const records = parseLimeSurveyCsv({ input: csvText, delimiter: "," })
  const header = records[0]
  const row = records[1]
  const replaceCell = (column, value) => {
    const changed = [...row]
    changed[header.indexOf(column)] = value
    return [header, changed].map((item) => item.join(",")).join("\r\n")
  }
  const scenario = fieldMap.scenarios[0].columns

  assert.throws(
    () =>
      importLimeSurveyMockCsv({
        csvText: replaceCell(scenario.scenarioCode, "unknown_case"),
        ...context,
      }),
    (error) => error.code === "SCENARIO_CODE_MISMATCH",
  )
  assert.throws(
    () =>
      importLimeSurveyMockCsv({
        csvText: replaceCell(scenario.pairReceiptHash, "0".repeat(64)),
        ...context,
      }),
    (error) => error.code === "PAIR_RECEIPT_HASH_MISMATCH",
  )
  assert.throws(
    () =>
      importLimeSurveyMockCsv({
        csvText: replaceCell(scenario.presentationOrder, "Y_THEN_X"),
        ...context,
      }),
    (error) => error.code === "PRESENTATION_ORDER_MISMATCH",
  )

  const duplicateSession = [header, row, row].map((item) => item.join(",")).join("\r\n")
  assert.throws(
    () => importLimeSurveyMockCsv({ csvText: duplicateSession, ...context }),
    (error) => error.code === "CSV_SESSION_DUPLICATE",
  )
  const duplicateAllocationRow = [...row]
  duplicateAllocationRow[header.indexOf(fieldMap.sessionColumns.sessionCode)] =
    context.sessionManifests[1].sessionCode
  const duplicateAllocation = [header, row, duplicateAllocationRow]
    .map((item) => item.join(","))
    .join("\r\n")
  assert.throws(
    () => importLimeSurveyMockCsv({ csvText: duplicateAllocation, ...context }),
    (error) => error.code === "CSV_ALLOCATION_DUPLICATE",
  )
})

test("blank, unshown scenarios and explicit CANNOTJUDGE remain distinct", () => {
  const complete = structuredClone(responseFixture[0])
  complete.scenarioRatings.synthetic_transit.scenarioPreference = null
  complete.scenarioRatings.synthetic_transit.X.editorialUsefulness = null
  const partialCsv = buildMockLimeSurveyCsv({
    responses: [
      {
        ...complete,
        completionStatus: "PARTIAL",
        scenarioRatings: { synthetic_transit: complete.scenarioRatings.synthetic_transit },
      },
    ],
    fieldMap,
  })
  const result = importLimeSurveyMockCsv({ csvText: partialCsv, ...context })
  const partial = result.responses[0]
  assert.equal(partial.completionStatus, "PARTIAL")
  assert.equal(Object.hasOwn(partial.scenarioRatings, "synthetic_library"), false)
  assert.equal(partial.scenarioRatings.synthetic_transit.scenarioPreference, null)
  assert.equal(partial.scenarioRatings.synthetic_transit.X.editorialUsefulness, null)

  const explicit = buildMockLimeSurveyCsv({ responses: responseFixture.slice(0, 1), fieldMap })
  assert.equal(
    importLimeSurveyMockCsv({ csvText: explicit, ...context }).responses[0].scenarioRatings
      .synthetic_library.scenarioPreference,
    "CANNOT_JUDGE",
  )
})

test("CSV quoted rationale round-trips without exposing it in adapter diagnostics", () => {
  const response = structuredClone(responseFixture[0])
  response.optionalRationale = 'A comma, a quote " and a line\nbreak.'
  const csvText = buildMockLimeSurveyCsv({ responses: [response], fieldMap })
  const result = importLimeSurveyMockCsv({ csvText, ...context })
  assert.equal(result.responses[0].optionalRationale, response.optionalRationale)

  const invalid = structuredClone(response)
  invalid.optionalRationale = "x".repeat(501)
  const invalidCsv = buildMockLimeSurveyCsv({ responses: [invalid], fieldMap })
  assert.throws(
    () => importLimeSurveyMockCsv({ csvText: invalidCsv, ...context }),
    (error) => error instanceof LimeSurveyCsvAdapterError && error.code === "SCHEMA_INVALID",
  )
})

test("consent and completion status are not inferred from preference values", () => {
  const csvText = buildMockLimeSurveyCsv({ responses: responseFixture.slice(0, 1), fieldMap })
  const records = parseLimeSurveyCsv({ input: csvText, delimiter: "," })
  const header = records[0]
  const row = records[1]
  const change = (column, value) => {
    const copy = [...row]
    copy[header.indexOf(column)] = value
    return [header, copy].map((item) => item.join(",")).join("\r\n")
  }

  assert.throws(
    () =>
      importLimeSurveyMockCsv({
        csvText: change(fieldMap.sessionColumns.consent, "N"),
        ...context,
      }),
    (error) => error.code === "CONSENT_NOT_ACCEPTED",
  )
  const partial = importLimeSurveyMockCsv({
    csvText: change(fieldMap.systemColumns.submittedAt, ""),
    ...context,
  })
  assert.equal(partial.responses[0].completionStatus, "PARTIAL")
  assert.equal(partial.responses[0].scenarioRatings.synthetic_transit.scenarioPreference, "X")
})

test("fixture map has unique stable question codes and a valid scheduled scenario set", () => {
  assert.equal(fieldMap.fixtureKind, "MOCK_CSV_CONTRACT")
  const codes = [
    ...Object.entries(fieldMap.sessionColumns)
      .filter(([key]) => key !== "studyOnlyPreferenceSeedKeys")
      .map(([, value]) => value),
    ...fieldMap.sessionColumns.studyOnlyPreferenceSeedKeys.map(({ column }) => column),
    ...Object.values(fieldMap.systemColumns).flatMap((value) =>
      Array.isArray(value) ? value : [value],
    ),
    ...fieldMap.scenarios.flatMap(({ columns }) => [
      ...Object.values(columns).filter((value) => typeof value === "string"),
      ...Object.values(columns.X),
      ...Object.values(columns.Y),
    ]),
  ].filter(
    (value) =>
      typeof value === "string" && !["id", "lastpage", "startlanguage", "seed"].includes(value),
  )
  assert.equal(new Set(codes).size, codes.length)
  assert.ok(codes.every((code) => /^[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)*$/.test(code)))
  assert.equal(validateAllocationSchedule(allocations, allocations.length), true)
  assert.deepEqual(
    fieldMap.scenarios.map(({ scenarioCode }) => scenarioCode),
    preRecruitmentManifest.scenarios.map(({ scenarioCode }) => scenarioCode),
  )
})
