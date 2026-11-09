import { reconcileSyntheticExport } from "./personalization-pilot-dummy-rehearsal-01.js"

const CONTRACT_VERSION = "LIMESURVEY_CE_RESPONSE_CSV_MOCK_V1"
const RECOGNIZED_DELIMITERS = new Set([",", ";", "\t"])
const ALLOWED_IGNORED_SYSTEM_COLUMNS = new Set(["id", "lastpage", "startlanguage", "seed"])
const ARM_NAMES = ["X", "Y"]
const RATING_NAMES = [
  "relevanceToDeclaredContext",
  "editorialUsefulness",
  "highlightInterest",
  "affinityVarietyBalance",
  "unnecessaryRepetition",
  "freshnessAdequacy",
  "organizationClarity",
  "predictabilityFindability",
  "confidence",
]
const VALID_PREFERENCES = new Set(["X", "Y", "TIE", "NEITHER", "CANNOT_JUDGE", null])

export class LimeSurveyCsvAdapterError extends Error {
  constructor(code) {
    super(code)
    this.name = "LimeSurveyCsvAdapterError"
    this.code = code
  }
}

const fail = (code) => {
  throw new LimeSurveyCsvAdapterError(code)
}

const decodeCsvInput = (input) => {
  if (Buffer.isBuffer(input)) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(input)
    } catch {
      fail("CSV_UTF8_INVALID")
    }
  }
  if (typeof input !== "string") {
    fail("CSV_INPUT_INVALID")
  }
  return input
}

const newlineWidthAt = (text, index) => {
  if (text[index] === "\r" && text[index + 1] === "\n") {
    return 2
  }
  return text[index] === "\r" || text[index] === "\n" ? 1 : 0
}

const parseCsvRecords = ({ input, delimiter }) => {
  if (typeof delimiter !== "string" || !RECOGNIZED_DELIMITERS.has(delimiter)) {
    fail("CSV_DELIMITER_UNSUPPORTED")
  }
  let text = decodeCsvInput(input)
  if (text.startsWith("\uFEFF")) {
    text = text.slice(1)
  }

  const records = []
  let record = []
  let field = ""
  let inQuotes = false
  let afterQuote = false
  let recordStarted = false

  const finishRecord = () => {
    record.push(field)
    records.push(record)
    record = []
    field = ""
    inQuotes = false
    afterQuote = false
    recordStarted = false
  }

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          inQuotes = false
          afterQuote = true
        }
      } else {
        field += character
      }
      continue
    }

    if (afterQuote) {
      if (character === delimiter) {
        record.push(field)
        field = ""
        afterQuote = false
        recordStarted = true
      } else {
        const newlineWidth = newlineWidthAt(text, index)
        if (newlineWidth) {
          finishRecord()
          index += newlineWidth - 1
        } else {
          fail("CSV_QUOTE_INVALID")
        }
      }
      continue
    }

    if (character === '"') {
      if (field.length > 0) {
        fail("CSV_QUOTE_INVALID")
      }
      inQuotes = true
      recordStarted = true
      continue
    }
    if (character === delimiter) {
      record.push(field)
      field = ""
      recordStarted = true
      continue
    }
    const newlineWidth = newlineWidthAt(text, index)
    if (newlineWidth) {
      finishRecord()
      index += newlineWidth - 1
      continue
    }
    field += character
    recordStarted = true
  }

  if (inQuotes) {
    fail("CSV_QUOTE_INVALID")
  }
  if (recordStarted || record.length > 0 || field.length > 0) {
    finishRecord()
  }
  return records
}

export const parseLimeSurveyCsv = ({ input, delimiter }) => {
  const records = parseCsvRecords({ input, delimiter })
  if (records.length > 1 && records.slice(1).some((row) => row.length !== records[0].length)) {
    fail("CSV_ROW_WIDTH_MISMATCH")
  }
  return records
}

const collectQuestionColumns = (fieldMap) => {
  const sessionColumns = fieldMap.sessionColumns ?? {}
  const seedColumns = sessionColumns.studyOnlyPreferenceSeedKeys ?? []
  const columns = [
    ...Object.entries(sessionColumns)
      .filter(([key]) => key !== "studyOnlyPreferenceSeedKeys")
      .map(([, value]) => value),
    ...seedColumns.map(({ column }) => column),
  ]
  for (const scenario of fieldMap.scenarios ?? []) {
    const scenarioColumns = scenario.columns ?? {}
    columns.push(
      scenarioColumns.scenarioCode,
      scenarioColumns.presented,
      scenarioColumns.pairReceiptHash,
      scenarioColumns.presentationOrder,
      scenarioColumns.scenarioPreference,
      ...ARM_NAMES.flatMap((arm) => RATING_NAMES.map((name) => scenarioColumns[arm]?.[name])),
    )
  }
  return columns
}

const validateFieldMap = (fieldMap) => {
  if (
    fieldMap?.fixtureKind !== "MOCK_CSV_CONTRACT" ||
    fieldMap?.contractVersion !== CONTRACT_VERSION ||
    fieldMap?.realLimeSurveyExport !== "NOT_TESTED"
  ) {
    fail("CSV_FORMAT_UNRECOGNIZED")
  }
  if (
    fieldMap.exportMode?.format !== "CSV" ||
    !RECOGNIZED_DELIMITERS.has(fieldMap.exportMode?.delimiter) ||
    fieldMap.exportMode?.headerRow !== 1 ||
    fieldMap.exportMode?.questionHeading !== "Question code" ||
    fieldMap.exportMode?.expressionScriptVariableNames !== true ||
    fieldMap.exportMode?.answerValues !== "CODES"
  ) {
    fail("CSV_FIELD_MAP_INVALID")
  }
  if (
    !fieldMap.systemColumns?.submittedAt ||
    !Array.isArray(fieldMap.systemColumns?.allowedIgnored) ||
    !Array.isArray(fieldMap.scenarios) ||
    fieldMap.scenarios.length === 0
  ) {
    fail("CSV_FIELD_MAP_INVALID")
  }

  const questionColumns = collectQuestionColumns(fieldMap)
  if (
    questionColumns.some(
      (column) =>
        typeof column !== "string" || !/^[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)*$/.test(column),
    ) ||
    new Set(questionColumns).size !== questionColumns.length
  ) {
    fail("CSV_FIELD_MAP_INVALID")
  }
  const scenarioCodes = fieldMap.scenarios.map(({ scenarioCode }) => scenarioCode)
  if (
    scenarioCodes.some((code) => typeof code !== "string" || !/^[a-z0-9_-]{1,80}$/.test(code)) ||
    new Set(scenarioCodes).size !== scenarioCodes.length
  ) {
    fail("CSV_FIELD_MAP_INVALID")
  }
  const systemColumns = [
    fieldMap.systemColumns.submittedAt,
    ...fieldMap.systemColumns.allowedIgnored,
  ]
  if (systemColumns.some((column) => typeof column !== "string" || !column)) {
    fail("CSV_FIELD_MAP_INVALID")
  }
  if (
    fieldMap.systemColumns.submittedAt !== "submitdate" ||
    fieldMap.systemColumns.allowedIgnored.some(
      (column) => !ALLOWED_IGNORED_SYSTEM_COLUMNS.has(column),
    )
  ) {
    fail("CSV_SYSTEM_COLUMN_UNAPPROVED")
  }
  if (new Set(systemColumns).size !== systemColumns.length) {
    fail("CSV_SYSTEM_COLUMN_DUPLICATE")
  }
  if (systemColumns.some((column) => questionColumns.includes(column))) {
    fail("CSV_FIELD_MAP_INVALID")
  }
}

const requiredHeadersFor = (fieldMap) => [
  fieldMap.systemColumns.submittedAt,
  ...collectQuestionColumns(fieldMap),
]

const validateHeaders = (headers, fieldMap) => {
  if (headers.some((header) => header.trim() === "")) {
    fail("CSV_HEADER_BLANK")
  }
  if (new Set(headers).size !== headers.length) {
    fail("CSV_HEADER_DUPLICATE")
  }

  const allowed = new Set([
    ...requiredHeadersFor(fieldMap),
    ...fieldMap.systemColumns.allowedIgnored,
  ])
  if (headers.some((header) => !allowed.has(header))) {
    fail("CSV_HEADER_UNKNOWN")
  }

  const present = new Set(headers)
  if (requiredHeadersFor(fieldMap).some((header) => !present.has(header))) {
    fail("CSV_HEADER_MISSING")
  }
}

const encodeValue = (value, { cannotJudge } = {}) => {
  if ([null, undefined, ""].includes(value)) {
    return ""
  }
  if (value === "CANNOT_JUDGE" && cannotJudge) {
    return cannotJudge
  }
  return String(value)
}

const csvEscape = (value, delimiter) => {
  const stringValue = String(value ?? "")
  if (
    stringValue.includes('"') ||
    stringValue.includes("\r") ||
    stringValue.includes("\n") ||
    stringValue.includes(delimiter)
  ) {
    return `"${stringValue.replaceAll('"', '""')}"`
  }
  return stringValue
}

export const buildMockLimeSurveyCsv = ({ responses, fieldMap }) => {
  validateFieldMap(fieldMap)
  if (!Array.isArray(responses) || responses.length === 0) {
    fail("CSV_NO_RESPONSE_ROWS")
  }
  const { delimiter } = fieldMap.exportMode
  const optionalSystemColumns = fieldMap.systemColumns.allowedIgnored
  const headers = [
    ...optionalSystemColumns,
    fieldMap.systemColumns.submittedAt,
    ...requiredHeadersFor(fieldMap).filter(
      (header) => header !== fieldMap.systemColumns.submittedAt,
    ),
  ]
  const rows = responses.map((response, responseIndex) => {
    const values = {
      id: String(responseIndex + 1),
      lastpage: "5",
      startlanguage: "en",
      seed: `mock${responseIndex + 1}`,
      [fieldMap.systemColumns.submittedAt]:
        response.completionStatus === "COMPLETE" ? "2026-11-08 12:00:00" : "",
      [fieldMap.sessionColumns.sessionCode]: response.sessionCode,
      [fieldMap.sessionColumns.allocationKey]: response.allocationKey,
      [fieldMap.sessionColumns.sessionManifestHash]: response.sessionManifestHash,
      [fieldMap.sessionColumns.consent]: response.consentAccepted
        ? fieldMap.codes.consentAccepted
        : "N",
      [fieldMap.sessionColumns.overallPreference]: encodeValue(response.overallPreference, {
        cannotJudge: fieldMap.codes.cannotJudge,
      }),
      [fieldMap.sessionColumns.optionalRationale]: response.optionalRationale ?? "",
    }
    for (const { key, column } of fieldMap.sessionColumns.studyOnlyPreferenceSeedKeys) {
      values[column] = response.studyOnlyPreferenceSeedKeys?.includes(key) ? "Y" : ""
    }

    for (const scenario of fieldMap.scenarios) {
      const scenarioColumns = scenario.columns
      const rating = response.scenarioRatings?.[scenario.scenarioCode]
      if (!rating) {
        for (const column of Object.values(scenarioColumns).flatMap((value) =>
          typeof value === "string" ? [value] : Object.values(value ?? {}),
        )) {
          values[column] = ""
        }
        continue
      }
      values[scenarioColumns.scenarioCode] = scenario.scenarioCode
      values[scenarioColumns.presented] = fieldMap.codes.presented
      values[scenarioColumns.pairReceiptHash] = rating.pairReceiptHash
      values[scenarioColumns.presentationOrder] = rating.presentationOrder
      values[scenarioColumns.scenarioPreference] = encodeValue(rating.scenarioPreference, {
        cannotJudge: fieldMap.codes.cannotJudge,
      })
      for (const arm of ARM_NAMES) {
        for (const name of RATING_NAMES) {
          const column = scenarioColumns[arm][name]
          const value = encodeValue(rating[arm]?.[name], {
            cannotJudge: fieldMap.codes.cannotJudge,
          })
          values[column] = value
        }
      }
    }
    return headers.map((header) => values[header] ?? "")
  })

  return [headers, ...rows]
    .map((row) => row.map((value) => csvEscape(value, delimiter)).join(delimiter))
    .join("\r\n")
}

const parsePreference = (value, fieldMap) => {
  if (value === "") {
    return null
  }
  const parsed = value === fieldMap.codes.cannotJudge ? "CANNOT_JUDGE" : value
  if (!VALID_PREFERENCES.has(parsed)) {
    fail("ENUM_INVALID")
  }
  return parsed
}

const parseRating = (value, fieldMap) => {
  if (value === "") {
    return null
  }
  if (value === fieldMap.codes.cannotJudge) {
    return "CANNOT_JUDGE"
  }
  if (/^[1-5]$/.test(value)) {
    return Number(value)
  }
  return value
}

const rowObject = (headers, row) =>
  Object.fromEntries(headers.map((header, index) => [header, row[index]]))

const ensureScenarioReceiptValues = ({ row, columns, pair }) => {
  const scenarioCode = row[columns.scenarioCode]
  if (scenarioCode !== "" && scenarioCode !== pair.scenarioCode) {
    fail("SCENARIO_CODE_MISMATCH")
  }
  const pairHash = row[columns.pairReceiptHash]
  if (pairHash !== "" && pairHash !== pair.pairReceiptHash) {
    fail("PAIR_RECEIPT_HASH_MISMATCH")
  }
  const presentationOrder = row[columns.presentationOrder]
  if (presentationOrder !== "" && presentationOrder !== pair.presentationOrder) {
    fail("PRESENTATION_ORDER_MISMATCH")
  }
}

const convertRows = ({ records, fieldMap, sessionManifests }) => {
  const headers = records[0]
  validateHeaders(headers, fieldMap)
  const rows = records.slice(1)
  if (rows.length === 0) {
    fail("CSV_NO_RESPONSE_ROWS")
  }
  if (rows.some((row) => row.length !== headers.length)) {
    fail("CSV_ROW_WIDTH_MISMATCH")
  }

  const manifestByAllocationKey = new Map(
    sessionManifests.map((manifest) => [manifest.allocationKey, manifest]),
  )
  if (manifestByAllocationKey.size !== sessionManifests.length) {
    fail("CSV_SESSION_JOIN_AMBIGUOUS")
  }

  const seenSessionCodes = new Set()
  const seenAllocationKeys = new Set()
  const responses = rows.map((csvRow) => {
    const source = rowObject(headers, csvRow)
    const sessionCode = source[fieldMap.sessionColumns.sessionCode]
    const allocationKey = source[fieldMap.sessionColumns.allocationKey]
    if (!sessionCode || !allocationKey) {
      fail("CSV_SESSION_IDENTITY_MISSING")
    }
    if (seenSessionCodes.has(sessionCode)) {
      fail("CSV_SESSION_DUPLICATE")
    }
    if (seenAllocationKeys.has(allocationKey)) {
      fail("CSV_ALLOCATION_DUPLICATE")
    }
    seenSessionCodes.add(sessionCode)
    seenAllocationKeys.add(allocationKey)

    const sessionManifest = manifestByAllocationKey.get(allocationKey)
    if (!sessionManifest) {
      fail("ALLOCATION_KEY_UNKNOWN")
    }
    const consentValue = source[fieldMap.sessionColumns.consent]
    if (consentValue !== fieldMap.codes.consentAccepted) {
      fail("CONSENT_NOT_ACCEPTED")
    }

    const studyOnlyPreferenceSeedKeys = []
    for (const { key, column } of fieldMap.sessionColumns.studyOnlyPreferenceSeedKeys) {
      const value = source[column]
      if (value === "Y") {
        studyOnlyPreferenceSeedKeys.push(key)
      } else if (value !== "" && value !== "N") {
        fail("PREFERENCE_SEED_VALUE_INVALID")
      }
    }

    const scenarioRatings = {}
    for (const scenario of fieldMap.scenarios) {
      const { columns } = scenario
      const pair = sessionManifest.scenarioPairs.find(
        ({ scenarioCode }) => scenarioCode === scenario.scenarioCode,
      )
      const presentedValue = source[columns.presented]
      const answerColumns = [
        columns.scenarioPreference,
        ...ARM_NAMES.flatMap((arm) => RATING_NAMES.map((name) => columns[arm][name])),
      ]
      const hasAnswers = answerColumns.some((column) => source[column] !== "")

      if (!pair) {
        if (presentedValue === fieldMap.codes.presented || hasAnswers) {
          fail("SCENARIO_NOT_SCHEDULED")
        }
        for (const column of [
          columns.scenarioCode,
          columns.pairReceiptHash,
          columns.presentationOrder,
        ]) {
          if (source[column] !== "") {
            fail("SCENARIO_NOT_SCHEDULED")
          }
        }
        continue
      }
      ensureScenarioReceiptValues({ row: source, columns, pair })
      if (presentedValue === "") {
        if (hasAnswers) {
          fail("CSV_RESPONSE_WITHOUT_PRESENTATION")
        }
        continue
      }
      if (presentedValue !== fieldMap.codes.presented) {
        fail("SCENARIO_PRESENTED_VALUE_INVALID")
      }
      if (
        source[columns.scenarioCode] !== scenario.scenarioCode ||
        source[columns.pairReceiptHash] === "" ||
        source[columns.presentationOrder] === ""
      ) {
        fail("SCENARIO_METADATA_MISSING")
      }
      const rating = {
        pairReceiptHash: source[columns.pairReceiptHash],
        presentationOrder: source[columns.presentationOrder],
        scenarioPreference: parsePreference(source[columns.scenarioPreference], fieldMap),
      }
      for (const arm of ARM_NAMES) {
        rating[arm] = Object.fromEntries(
          RATING_NAMES.map((name) => [name, parseRating(source[columns[arm][name]], fieldMap)]),
        )
      }
      scenarioRatings[scenario.scenarioCode] = rating
    }

    const submittedAt = source[fieldMap.systemColumns.submittedAt]
    const completionStatus = submittedAt.trim() === "" ? "PARTIAL" : "COMPLETE"
    return {
      schemaVersion: "1.0",
      studyCode: "PERSONALIZATION_HUMAN_RELEVANCE_PILOT_01",
      sessionCode,
      consentAccepted: true,
      completionStatus,
      sessionManifestHash: source[fieldMap.sessionColumns.sessionManifestHash],
      studyOnlyPreferenceSeedKeys,
      scenarioRatings,
      overallPreference: parsePreference(
        source[fieldMap.sessionColumns.overallPreference],
        fieldMap,
      ),
      allocationKey,
      optionalRationale:
        source[fieldMap.sessionColumns.optionalRationale] === ""
          ? null
          : source[fieldMap.sessionColumns.optionalRationale],
    }
  })

  return responses
}

export const importLimeSurveyMockCsv = ({
  csvText,
  fieldMap,
  sessionManifests,
  allocations,
  preRecruitmentManifest,
} = {}) => {
  validateFieldMap(fieldMap)
  const expectedScenarioCodes = preRecruitmentManifest?.scenarios?.map(
    ({ scenarioCode }) => scenarioCode,
  )
  const mappedScenarioCodes = fieldMap.scenarios.map(({ scenarioCode }) => scenarioCode)
  if (
    !Array.isArray(expectedScenarioCodes) ||
    JSON.stringify(mappedScenarioCodes) !== JSON.stringify(expectedScenarioCodes)
  ) {
    fail("CSV_SCENARIO_FIELD_MAP_MISMATCH")
  }
  const records = parseCsvRecords({ input: csvText, delimiter: fieldMap.exportMode.delimiter })
  if (records.length < 2) {
    fail("CSV_NO_RESPONSE_ROWS")
  }
  const responses = convertRows({ records, fieldMap, sessionManifests })
  const report = reconcileSyntheticExport({
    rawExportText: JSON.stringify({ fixtureKind: "SYNTHETIC_ONLY", responses }),
    sessionManifests,
    allocations,
    preRecruitmentManifest,
  })
  if (report.rejectedResponseCount > 0) {
    const rejectionCodes = Object.keys(report.rejectionReasons)
    fail(rejectionCodes.length === 1 ? rejectionCodes[0] : "CSV_RECONCILIATION_REJECTED")
  }
  return {
    sourceKind: "MOCK_CSV_CONTRACT",
    contractVersion: fieldMap.contractVersion,
    responses,
    report: {
      ...report,
      sourceKind: "MOCK_CSV_CONTRACT",
      limeSurveyIntegrationGate: "NOT_TESTED",
      humanRelevanceMeasured: false,
    },
  }
}
