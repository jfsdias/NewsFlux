/* eslint-disable import/no-relative-parent-imports -- The offline harness intentionally calls production projection helpers. */
import { createHash, randomBytes, randomInt } from "node:crypto"
import { readFileSync } from "node:fs"

import Ajv2020 from "ajv/dist/2020.js"

import {
  createHomeEditorialSession,
  hasHomeEditorialCompositionChanged,
  projectHomeSession,
} from "../../src/utils/home-editorial-session.js"
import { HOME_PERSONALIZATION_FRESHNESS_WINDOW } from "../../src/utils/home-personalization-constants.js"
import {
  commitHomePersonalizationSnapshot,
  createHomePersonalizationGeneration,
  resolveHomePersonalizationProfile,
} from "../../src/utils/home-personalization-generation.js"
import { createHomePersonalizationProfile } from "../../src/utils/home-personalization-profile.js"
import { projectHomePersonalization } from "../../src/utils/home-personalization-projection.js"

const RESPONSE_SCHEMA_PATH = new URL(
  "../../docs/research/templates/personalization-human-relevance-pilot-01-data.schema.json",
  import.meta.url,
)
const REHEARSAL_FIXTURE_DIRECTORY = new URL("fixtures/", import.meta.url)
const HASH_PATTERN = /^[a-f\d]{64}$/
const SCENARIO_CODE_PATTERN = /^[a-z0-9_-]{1,80}$/
const ALGORITHM_PHASE2C = "PHASE_2C_DETERMINISTIC"
const ALGORITHM_V1 = "PERSONALIZATION_V1"
const PREFERENCE_VALUES = new Set(["X", "Y", "TIE", "NEITHER", "CANNOT_JUDGE", null])

export class PilotRehearsalError extends Error {
  constructor(code) {
    super(code)
    this.name = "PilotRehearsalError"
    this.code = code
  }
}

const fail = (code) => {
  throw new PilotRehearsalError(code)
}

class StrictJsonReader {
  constructor(text) {
    if (typeof text !== "string") {
      fail("JSON_INPUT_NOT_TEXT")
    }
    this.text = text
    this.position = 0
  }

  read() {
    this.skipWhitespace()
    const value = this.readValue()
    this.skipWhitespace()
    if (this.position !== this.text.length) {
      fail("INVALID_JSON")
    }
    return value
  }

  skipWhitespace() {
    while ([" ", "\n", "\r", "\t"].includes(this.text[this.position])) {
      this.position += 1
    }
  }

  readValue() {
    this.skipWhitespace()
    const character = this.text[this.position]
    if (character === "{") {
      return this.readObject()
    }
    if (character === "[") {
      return this.readArray()
    }
    if (character === '"') {
      return this.readString()
    }
    if (character === "t") {
      return this.readLiteral("true", true)
    }
    if (character === "f") {
      return this.readLiteral("false", false)
    }
    if (character === "n") {
      return this.readLiteral("null", null)
    }
    if (character === "-" || /[0-9]/.test(character ?? "")) {
      return this.readNumber()
    }
    fail("INVALID_JSON")
  }

  readObject() {
    this.position += 1
    this.skipWhitespace()
    const object = {}
    const keys = new Set()
    if (this.text[this.position] === "}") {
      this.position += 1
      return object
    }

    while (this.position < this.text.length) {
      this.skipWhitespace()
      if (this.text[this.position] !== '"') {
        fail("INVALID_JSON")
      }
      const key = this.readString()
      if (keys.has(key)) {
        fail("DUPLICATE_JSON_KEY")
      }
      keys.add(key)
      this.skipWhitespace()
      if (this.text[this.position] !== ":") {
        fail("INVALID_JSON")
      }
      this.position += 1
      Object.defineProperty(object, key, {
        value: this.readValue(),
        enumerable: true,
        writable: true,
        configurable: true,
      })
      this.skipWhitespace()
      const delimiter = this.text[this.position]
      if (delimiter === "}") {
        this.position += 1
        return object
      }
      if (delimiter !== ",") {
        fail("INVALID_JSON")
      }
      this.position += 1
    }
    fail("INVALID_JSON")
  }

  readArray() {
    this.position += 1
    this.skipWhitespace()
    const values = []
    if (this.text[this.position] === "]") {
      this.position += 1
      return values
    }

    while (this.position < this.text.length) {
      values.push(this.readValue())
      this.skipWhitespace()
      const delimiter = this.text[this.position]
      if (delimiter === "]") {
        this.position += 1
        return values
      }
      if (delimiter !== ",") {
        fail("INVALID_JSON")
      }
      this.position += 1
    }
    fail("INVALID_JSON")
  }

  readString() {
    const start = this.position
    this.position += 1
    while (this.position < this.text.length) {
      const code = this.text.codePointAt(this.position)
      if (code === 0x22) {
        this.position += 1
        try {
          return JSON.parse(this.text.slice(start, this.position))
        } catch {
          fail("INVALID_JSON")
        }
      }
      if (code < 0x20) {
        fail("INVALID_JSON")
      }
      if (code === 0x5c) {
        const escape = this.text[this.position + 1]
        if (escape === "u") {
          const digits = this.text.slice(this.position + 2, this.position + 6)
          if (!/^[a-f\d]{4}$/i.test(digits)) {
            fail("INVALID_JSON")
          }
          this.position += 6
        } else {
          if (!String.raw`"\/bfnrt`.includes(escape ?? "")) {
            fail("INVALID_JSON")
          }
          this.position += 2
        }
        continue
      }
      this.position += 1
    }
    fail("INVALID_JSON")
  }

  readNumber() {
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(
      this.text.slice(this.position),
    )
    if (!number) {
      fail("INVALID_JSON")
    }
    this.position += number[0].length
    const value = Number(number[0])
    if (!Number.isFinite(value)) {
      fail("INVALID_JSON_NUMBER")
    }
    return value
  }

  readLiteral(text, value) {
    if (this.text.slice(this.position, this.position + text.length) !== text) {
      fail("INVALID_JSON")
    }
    this.position += text.length
    return value
  }
}

export const parseStrictJson = (text) => new StrictJsonReader(text).read()

const canonicalize = (value, seen = new WeakSet()) => {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      fail("UNHASHABLE_NUMBER")
    }
    return value
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      fail("UNHASHABLE_CYCLE")
    }
    seen.add(value)
    const result = value.map((item) => canonicalize(item, seen))
    seen.delete(value)
    return result
  }
  if (typeof value === "object") {
    if (seen.has(value)) {
      fail("UNHASHABLE_CYCLE")
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      fail("UNHASHABLE_OBJECT")
    }
    seen.add(value)
    const result = Object.fromEntries(
      Object.keys(value)
        .toSorted()
        .map((key) => [key, canonicalize(value[key], seen)]),
    )
    seen.delete(value)
    return result
  }
  fail("UNHASHABLE_VALUE")
}

export const canonicalJson = (value) => JSON.stringify(canonicalize(value))

export const sha256 = (value) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : canonicalJson(value), "utf8")
    .digest("hex")

const cloneJson = (value) => structuredClone(value)

const deepFreeze = (value, seen = new WeakSet()) => {
  if (value === null || typeof value !== "object" || seen.has(value)) {
    return value
  }
  seen.add(value)
  for (const child of Object.values(value)) {
    deepFreeze(child, seen)
  }
  return Object.freeze(value)
}

const withHash = (value, hashKey) => {
  const { [hashKey]: _ignored, ...body } = value
  return body
}

const assertUnique = (values, code) => {
  if (new Set(values).size !== values.length) {
    fail(code)
  }
}

const isHash = (value) => typeof value === "string" && HASH_PATTERN.test(value)

const articleMetadata = (entry) => ({
  id: entry.id,
  title: entry.title,
  publishedAt: entry.published_at,
  feed: {
    id: entry.feed?.id ?? null,
    title: entry.feed?.title ?? null,
    category: {
      id: entry.feed?.category?.id ?? null,
      title: entry.feed?.category?.title ?? null,
    },
  },
})

const validateStimulusFixture = (fixture) => {
  if (fixture?.fixtureKind !== "SYNTHETIC_ONLY") {
    fail("FIXTURE_NOT_SYNTHETIC")
  }
  if (!Array.isArray(fixture.articles) || !Array.isArray(fixture.scenarios)) {
    fail("PRE_RECRUITMENT_FIXTURE_INVALID")
  }
  const articleIds = fixture.articles.map(({ id }) => String(id))
  assertUnique(articleIds, "DUPLICATE_ARTICLE_ID")
  const articleById = new Map(fixture.articles.map((entry) => [String(entry.id), entry]))
  const scenarioCodes = fixture.scenarios.map(({ scenarioCode }) => scenarioCode)
  assertUnique(scenarioCodes, "DUPLICATE_SCENARIO_ID")
  for (const scenario of fixture.scenarios) {
    if (!SCENARIO_CODE_PATTERN.test(scenario.scenarioCode)) {
      fail("SCENARIO_ID_INVALID")
    }
    if (!Array.isArray(scenario.eligibleArticleIds)) {
      fail("SCENARIO_ARTICLE_SET_INVALID")
    }
    assertUnique(scenario.eligibleArticleIds.map(String), "DUPLICATE_SCENARIO_ARTICLE_ID")
    for (const id of scenario.eligibleArticleIds) {
      const entry = articleById.get(String(id))
      if (!entry) {
        fail("SCENARIO_ARTICLE_UNKNOWN")
      }
      if (entry.status !== fixture.rules?.eligibleStatus) {
        fail("SCENARIO_ARTICLE_INELIGIBLE")
      }
    }
  }
  const profileKeys = (fixture.profileSeeds ?? []).map(({ key }) => key)
  assertUnique(profileKeys, "DUPLICATE_PROFILE_SEED_KEY")
  for (const seed of fixture.profileSeeds ?? []) {
    if (typeof seed.key !== "string" || !seed.key.startsWith("synthetic-")) {
      fail("PROFILE_SEED_NOT_SYNTHETIC")
    }
    if (seed.entry?.status !== "read" || seed.entry?.starred !== true) {
      fail("PROFILE_SEED_INVALID")
    }
  }
  return articleById
}

export const createPreRecruitmentManifest = (fixture) => {
  const articleById = validateStimulusFixture(fixture)
  const contentHashes = Object.fromEntries(
    [...articleById.entries()]
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([id, entry]) => [id, sha256(entry.content ?? "")]),
  )
  const metadataHashes = Object.fromEntries(
    [...articleById.entries()]
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([id, entry]) => [id, sha256(articleMetadata(entry))]),
  )
  const articleSetHash = sha256({
    ids: [...articleById.keys()].toSorted(),
    contentHashes,
    metadataHashes,
  })
  const body = {
    schemaVersion: "PILOT_PRE_RECRUITMENT_MANIFEST_V1",
    fixtureKind: "SYNTHETIC_ONLY",
    studyCode: "PERSONALIZATION_HUMAN_RELEVANCE_PILOT_01",
    frozenAt: fixture.frozenAt,
    referenceBaseSha: fixture.referenceBaseSha,
    locale: fixture.locale,
    theme: fixture.theme,
    viewport: cloneJson(fixture.viewport),
    rendererRevision: fixture.rendererRevision,
    algorithmRevisions: cloneJson(fixture.algorithmRevisions),
    rules: cloneJson(fixture.rules),
    scenarios: cloneJson(fixture.scenarios),
    articles: cloneJson(fixture.articles),
    profileSeeds: cloneJson(fixture.profileSeeds ?? []),
    articleContentHashes: contentHashes,
    articleMetadataHashes: metadataHashes,
    articleSetHash,
  }
  return deepFreeze({ ...body, manifestHash: sha256(body) })
}

export const validatePreRecruitmentManifest = (manifest) => {
  if (manifest?.fixtureKind !== "SYNTHETIC_ONLY") {
    fail("PRE_RECRUITMENT_MANIFEST_NOT_SYNTHETIC")
  }
  if (
    !isHash(manifest?.manifestHash) ||
    sha256(withHash(manifest, "manifestHash")) !== manifest.manifestHash
  ) {
    fail("PRE_RECRUITMENT_MANIFEST_HASH_MISMATCH")
  }
  const expectedManifest = createPreRecruitmentManifest(manifest)
  if (canonicalJson(manifest) !== canonicalJson(expectedManifest)) {
    fail("PRE_RECRUITMENT_MANIFEST_CONTENT_MISMATCH")
  }
  return true
}

const randomIndex = (upperBound, randomIntImpl) => {
  const value = randomIntImpl(upperBound)
  if (!Number.isSafeInteger(value) || value < 0 || value >= upperBound) {
    fail("RANDOM_SOURCE_INVALID")
  }
  return value
}

const fisherYates = (values, randomIntImpl) => {
  const shuffled = [...values]
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const selected = randomIndex(index + 1, randomIntImpl)
    ;[shuffled[index], shuffled[selected]] = [shuffled[selected], shuffled[index]]
  }
  return shuffled
}

const validateAllocation = (assignment) => {
  if (!assignment || typeof assignment !== "object") {
    fail("ALLOCATION_INVALID")
  }
  if (typeof assignment.sessionCode !== "string" || assignment.sessionCode.length < 8) {
    fail("SESSION_CODE_INVALID")
  }
  if (typeof assignment.allocationKey !== "string" || assignment.allocationKey.length < 8) {
    fail("ALLOCATION_KEY_INVALID")
  }
  if (!Number.isSafeInteger(assignment.slotIndex) || assignment.slotIndex < 0) {
    fail("ALLOCATION_SLOT_INVALID")
  }
  if (!["PHASE_2C_FIRST", "V1_FIRST"].includes(assignment.presentationOrder)) {
    fail("PRESENTATION_ORDER_INVALID")
  }
  if (
    !assignment.armMapping ||
    ![ALGORITHM_PHASE2C, ALGORITHM_V1].includes(assignment.armMapping.X) ||
    ![ALGORITHM_PHASE2C, ALGORITHM_V1].includes(assignment.armMapping.Y) ||
    assignment.armMapping.X === assignment.armMapping.Y
  ) {
    fail("ALLOCATION_MAPPING_INVALID")
  }
  return true
}

export const validateAllocationSchedule = (
  assignments,
  expectedSessionCount = assignments?.length,
) => {
  if (!Array.isArray(assignments) || !Number.isSafeInteger(expectedSessionCount)) {
    fail("ALLOCATION_SCHEDULE_INVALID")
  }
  if (expectedSessionCount < 4 || expectedSessionCount % 4 !== 0) {
    fail("ALLOCATION_BLOCK_SIZE_INVALID")
  }
  if (assignments.length !== expectedSessionCount) {
    fail("ALLOCATION_COUNT_MISMATCH")
  }
  for (const [index, assignment] of assignments.entries()) {
    if (assignment.slotIndex !== index) {
      fail("ALLOCATION_SLOT_ORDER_MISMATCH")
    }
    validateAllocation(assignment)
  }
  assertUnique(
    assignments.map(({ sessionCode }) => sessionCode),
    "SESSION_CODE_REUSED",
  )
  assertUnique(
    assignments.map(({ allocationKey }) => allocationKey),
    "ALLOCATION_KEY_REUSED",
  )
  assertUnique(
    assignments.map(({ slotIndex }) => slotIndex),
    "ALLOCATION_SLOT_REUSED",
  )
  for (let start = 0; start < assignments.length; start += 4) {
    const block = assignments.slice(start, start + 4)
    if (
      block.filter(({ presentationOrder }) => presentationOrder === "PHASE_2C_FIRST").length !== 2
    ) {
      fail("COUNTERBALANCE_BLOCK_INVALID")
    }
    if (block.filter(({ presentationOrder }) => presentationOrder === "V1_FIRST").length !== 2) {
      fail("COUNTERBALANCE_BLOCK_INVALID")
    }
  }
  return true
}

export const createBlindAllocationSchedule = ({
  sessionCount,
  randomIntImpl = randomInt,
  randomBytesImpl = randomBytes,
} = {}) => {
  if (!Number.isSafeInteger(sessionCount) || sessionCount < 4 || sessionCount % 4 !== 0) {
    fail("ALLOCATION_BLOCK_SIZE_INVALID")
  }
  if (typeof randomIntImpl !== "function" || typeof randomBytesImpl !== "function") {
    fail("RANDOM_SOURCE_INVALID")
  }
  const sessionCodes = Array.from(
    { length: sessionCount },
    () => `SYNTHETIC-${randomBytesImpl(12).toString("hex")}`,
  )
  const allocationKeys = Array.from({ length: sessionCount }, () =>
    randomBytesImpl(16).toString("hex"),
  )
  const assignments = []
  for (let start = 0; start < sessionCount; start += 4) {
    const orders = fisherYates(
      ["PHASE_2C_FIRST", "PHASE_2C_FIRST", "V1_FIRST", "V1_FIRST"],
      randomIntImpl,
    )
    for (let offset = 0; offset < 4; offset += 1) {
      const slotIndex = start + offset
      const phase2cFirst = randomIndex(2, randomIntImpl) === 0
      assignments.push({
        slotIndex,
        sessionCode: sessionCodes[slotIndex],
        allocationKey: allocationKeys[slotIndex],
        presentationOrder: orders[offset],
        armMapping: phase2cFirst
          ? { X: ALGORITHM_PHASE2C, Y: ALGORITHM_V1 }
          : { X: ALGORITHM_V1, Y: ALGORITHM_PHASE2C },
      })
    }
  }
  validateAllocationSchedule(assignments, sessionCount)
  return deepFreeze(assignments)
}

const getLabelPresentationOrder = (allocation) => {
  const firstAlgorithm =
    allocation.presentationOrder === "PHASE_2C_FIRST" ? ALGORITHM_PHASE2C : ALGORITHM_V1
  return allocation.armMapping.X === firstAlgorithm ? "X_THEN_Y" : "Y_THEN_X"
}

const sectionProjection = (entries, requestKey, initialProjection = null) => {
  const session = createHomeEditorialSession({
    requestKey,
    sessionRevision: 1,
    entries,
    ...(initialProjection ? { initialProjection } : {}),
  })
  const sections = projectHomeSession(session, entries)
  const articleIds = [
    ...sections.highlightIds,
    ...sections.categoryLanes.flatMap(({ entryIds }) => entryIds),
    ...sections.latestIds,
  ]
  const readerOrderIds = [...sections.highlightIds, ...sections.readerRecentIds]
  return { session, sections, articleIds, readerOrderIds }
}

const composeV1 = ({ entries, profile, baselineComposition, requestKey, generationId }) => {
  const projection = projectHomePersonalization({
    entries,
    baselineHighlightIds: baselineComposition.session.highlightIds,
    baselineRecentIds: baselineComposition.session.recentIds,
    profile,
    freshnessWindow: HOME_PERSONALIZATION_FRESHNESS_WINDOW,
  })
  const preview = sectionProjection(entries, `${requestKey}:v1-preview`, projection)
  const context = {
    generationId,
    requestKey,
    canonicalRequestKey: `${requestKey}:canonical`,
    identityKey: `${requestKey}:identity`,
    sessionRevision: 1,
  }
  let generation = createHomePersonalizationGeneration(context)
  generation = resolveHomePersonalizationProfile(generation, { ...context, profile })
  const committed = commitHomePersonalizationSnapshot(generation, {
    ...context,
    baselineProjection: baselineComposition.sections,
    personalizedProjection: projection,
    disclosureVisible: hasHomeEditorialCompositionChanged(
      baselineComposition.sections,
      preview.sections,
    ),
  }).generation
  if (committed.projectionApplied) {
    return sectionProjection(entries, `${requestKey}:v1-final`, committed.projection)
  }
  return baselineComposition
}

const makeProfile = (preRecruitmentManifest, profileSeedKeys) => {
  if (!Array.isArray(profileSeedKeys)) {
    fail("PROFILE_PREFERENCES_INVALID")
  }
  assertUnique(profileSeedKeys, "PROFILE_SEED_KEY_REUSED")
  if (profileSeedKeys.length > preRecruitmentManifest.rules.maxProfileSeedItems) {
    fail("PROFILE_SEED_LIMIT_EXCEEDED")
  }
  const seedByKey = new Map(
    preRecruitmentManifest.profileSeeds.map(({ key, entry }) => [key, entry]),
  )
  const profileSeedEntries = profileSeedKeys.map((key) => {
    const entry = seedByKey.get(key)
    if (!entry) {
      fail("PROFILE_SEED_UNKNOWN")
    }
    return cloneJson(entry)
  })
  return {
    profile: createHomePersonalizationProfile({
      entries: profileSeedEntries,
      hiddenFeedIds: new Set(),
    }),
    profileSeedEntries,
  }
}

const getEntryMetadataById = (preRecruitmentManifest) =>
  new Map(
    preRecruitmentManifest.articles.map((entry) => [String(entry.id), articleMetadata(entry)]),
  )

const serializeArm = (composition, algorithmRevision, metadataById) => ({
  algorithmRevision,
  highlightIds: [...composition.sections.highlightIds],
  categoryLanes: composition.sections.categoryLanes.map((lane) => ({
    categoryId: lane.categoryId,
    categoryTitle: lane.categoryTitle,
    entryIds: [...lane.entryIds],
  })),
  latestIds: [...composition.sections.latestIds],
  articleIds: [...composition.articleIds],
  readerOrderIds: [...composition.readerOrderIds],
  articleMetadata: composition.articleIds.map((id) => {
    const metadata = metadataById.get(String(id))
    if (!metadata) {
      fail("ARTICLE_METADATA_UNKNOWN")
    }
    return cloneJson(metadata)
  }),
})

const buildScenarioPair = ({
  scenario,
  scenarioOrderIndex,
  preRecruitmentManifest,
  allocation,
  profile,
  requestKey,
}) => {
  const entryById = new Map(
    preRecruitmentManifest.articles.map((entry) => [String(entry.id), entry]),
  )
  const entries = scenario.eligibleArticleIds.map((id) => {
    const entry = entryById.get(String(id))
    if (!entry) {
      fail("SCENARIO_ARTICLE_UNKNOWN")
    }
    if (entry.status !== preRecruitmentManifest.rules.eligibleStatus) {
      fail("SCENARIO_ARTICLE_INELIGIBLE")
    }
    return cloneJson(entry)
  })
  const baselineComposition = sectionProjection(
    entries,
    `${requestKey}:${scenario.scenarioCode}:phase2c`,
  )
  const personalizedComposition = composeV1({
    entries,
    profile,
    baselineComposition,
    requestKey: `${requestKey}:${scenario.scenarioCode}`,
    generationId: scenarioOrderIndex + 1,
  })
  const metadataById = getEntryMetadataById(preRecruitmentManifest)
  const compositionByAlgorithm = {
    [ALGORITHM_PHASE2C]: serializeArm(
      baselineComposition,
      preRecruitmentManifest.algorithmRevisions.phase2c,
      metadataById,
    ),
    [ALGORITHM_V1]: serializeArm(
      personalizedComposition,
      preRecruitmentManifest.algorithmRevisions.personalizationV1,
      metadataById,
    ),
  }
  const pair = {
    scenarioCode: scenario.scenarioCode,
    scenarioOrderIndex,
    eligibleArticleIds: [...scenario.eligibleArticleIds],
    articleSetHash: sha256(
      scenario.eligibleArticleIds
        .map(String)
        .toSorted()
        .map((id) => ({
          id,
          metadataHash: preRecruitmentManifest.articleMetadataHashes[id],
          contentHash: preRecruitmentManifest.articleContentHashes[id],
        })),
    ),
    rendererRevision: preRecruitmentManifest.rendererRevision,
    armMapping: cloneJson(allocation.armMapping),
    presentationOrder: getLabelPresentationOrder(allocation),
    randomizedAlgorithmOrder: allocation.presentationOrder,
    arms: {
      X: compositionByAlgorithm[allocation.armMapping.X],
      Y: compositionByAlgorithm[allocation.armMapping.Y],
    },
  }
  return { ...pair, pairReceiptHash: sha256(pair) }
}

export const createSessionManifest = ({
  preRecruitmentManifest,
  allocation,
  profileSeedKeys,
  scenarioCodes = preRecruitmentManifest?.scenarios?.map(({ scenarioCode }) => scenarioCode),
}) => {
  validatePreRecruitmentManifest(preRecruitmentManifest)
  validateAllocation(allocation)
  if (!Array.isArray(scenarioCodes) || scenarioCodes.length === 0) {
    fail("SCENARIO_SET_INVALID")
  }
  assertUnique(scenarioCodes, "DUPLICATE_SCENARIO_ID")
  const scenarioByCode = new Map(
    preRecruitmentManifest.scenarios.map((scenario) => [scenario.scenarioCode, scenario]),
  )
  for (const code of scenarioCodes) {
    if (!SCENARIO_CODE_PATTERN.test(code)) {
      fail("SCENARIO_ID_INVALID")
    }
    if (!scenarioByCode.has(code)) {
      fail("SCENARIO_UNKNOWN")
    }
  }
  const { profile, profileSeedEntries } = makeProfile(preRecruitmentManifest, profileSeedKeys)
  const profileSeedReferences = {
    keys: [...profileSeedKeys],
    hash: sha256(profileSeedEntries.map(({ id, feed, starred }) => ({ id, feed, starred }))),
  }
  const requestKey = `synthetic-pilot:${allocation.sessionCode}`
  const scenarioPairs = scenarioCodes.map((scenarioCode, scenarioOrderIndex) =>
    buildScenarioPair({
      scenario: scenarioByCode.get(scenarioCode),
      scenarioOrderIndex,
      preRecruitmentManifest,
      allocation,
      profile,
      requestKey,
    }),
  )
  const body = {
    schemaVersion: "PILOT_SESSION_RECEIPT_V1",
    fixtureKind: "SYNTHETIC_ONLY",
    referenceBaseSha: preRecruitmentManifest.referenceBaseSha,
    sessionCode: allocation.sessionCode,
    allocationKey: allocation.allocationKey,
    slotIndex: allocation.slotIndex,
    preRecruitmentManifestHash: preRecruitmentManifest.manifestHash,
    profileSeedReferences,
    rendererRevision: preRecruitmentManifest.rendererRevision,
    armMapping: cloneJson(allocation.armMapping),
    presentationOrder: allocation.presentationOrder,
    labelPresentationOrder: getLabelPresentationOrder(allocation),
    scenarioOrder: [...scenarioCodes],
    scenarioPairs,
  }
  return deepFreeze({ ...body, sessionManifestHash: sha256(body) })
}

const assertArmCoverage = ({ arm, pair, preRecruitmentManifest }) => {
  if (!Array.isArray(arm.articleIds) || !Array.isArray(arm.readerOrderIds)) {
    fail("ARTICLE_COVERAGE_MISMATCH")
  }
  assertUnique(arm.articleIds.map(String), "ARTICLE_DUPLICATE")
  const eligibleKeys = pair.eligibleArticleIds.map(String).toSorted()
  if (
    arm.articleIds.length !== eligibleKeys.length ||
    canonicalJson(arm.articleIds.map(String).toSorted()) !== canonicalJson(eligibleKeys)
  ) {
    fail("ARTICLE_COVERAGE_MISMATCH")
  }
  const visualIds = [
    ...arm.highlightIds,
    ...arm.categoryLanes.flatMap(({ entryIds }) => entryIds),
    ...arm.latestIds,
  ]
  if (canonicalJson(visualIds) !== canonicalJson(arm.articleIds)) {
    fail("COMPOSITION_INVALID")
  }
  if (canonicalJson(arm.readerOrderIds) !== canonicalJson(arm.articleIds)) {
    fail("READER_ORDER_MISMATCH")
  }
  const sectionIds = [
    ...arm.highlightIds,
    ...arm.categoryLanes.flatMap(({ entryIds }) => entryIds),
    ...arm.latestIds,
  ]
  assertUnique(sectionIds.map(String), "ARTICLE_DUPLICATE")
  const metadataById = getEntryMetadataById(preRecruitmentManifest)
  if (!Array.isArray(arm.articleMetadata) || arm.articleMetadata.length !== arm.articleIds.length) {
    fail("ARTICLE_METADATA_MISMATCH")
  }
  for (const [index, id] of arm.articleIds.entries()) {
    const expected = metadataById.get(String(id))
    if (!expected || canonicalJson(arm.articleMetadata[index]) !== canonicalJson(expected)) {
      fail("ARTICLE_METADATA_MISMATCH")
    }
  }
  for (const lane of arm.categoryLanes) {
    for (const id of lane.entryIds) {
      const metadata = metadataById.get(String(id))
      if (String(metadata?.feed?.category?.id) !== String(lane.categoryId)) {
        fail("CATEGORY_IDENTITY_MISMATCH")
      }
    }
  }
}

const sessionBody = (manifest) => withHash(manifest, "sessionManifestHash")
const pairBody = (pair) => withHash(pair, "pairReceiptHash")

export const validateSessionManifest = ({
  manifest,
  frozenManifest,
  preRecruitmentManifest,
  allocation,
}) => {
  validatePreRecruitmentManifest(preRecruitmentManifest)
  validateAllocation(allocation)
  if (!manifest || !frozenManifest || manifest.fixtureKind !== "SYNTHETIC_ONLY") {
    fail("SESSION_MANIFEST_INVALID")
  }
  if (
    manifest.sessionCode !== allocation.sessionCode ||
    manifest.allocationKey !== allocation.allocationKey ||
    manifest.slotIndex !== allocation.slotIndex
  ) {
    fail("SESSION_ALLOCATION_MISMATCH")
  }
  if (canonicalJson(manifest.armMapping) !== canonicalJson(allocation.armMapping)) {
    fail("ALLOCATION_MAPPING_MISMATCH")
  }
  if (manifest.presentationOrder !== allocation.presentationOrder) {
    fail("PRESENTATION_ORDER_MISMATCH")
  }
  if (manifest.labelPresentationOrder !== getLabelPresentationOrder(allocation)) {
    fail("LABEL_PRESENTATION_ORDER_MISMATCH")
  }
  if (manifest.preRecruitmentManifestHash !== preRecruitmentManifest.manifestHash) {
    fail("PRE_RECRUITMENT_MANIFEST_MISMATCH")
  }
  if (
    canonicalJson(manifest.profileSeedReferences?.keys) !==
    canonicalJson(frozenManifest.profileSeedReferences?.keys)
  ) {
    fail("PROFILE_PREFERENCES_CHANGED")
  }
  if (
    canonicalJson(manifest.scenarioOrder) !== canonicalJson(frozenManifest.scenarioOrder) ||
    canonicalJson(manifest.rendererRevision) !== canonicalJson(frozenManifest.rendererRevision)
  ) {
    fail("SESSION_MANIFEST_CHANGED_AFTER_FREEZE")
  }
  const { profileSeedEntries } = makeProfile(
    preRecruitmentManifest,
    manifest.profileSeedReferences?.keys,
  )
  const expectedSeedHash = sha256(
    profileSeedEntries.map(({ id, feed, starred }) => ({ id, feed, starred })),
  )
  if (manifest.profileSeedReferences?.hash !== expectedSeedHash) {
    fail("PROFILE_SEED_HASH_MISMATCH")
  }
  if (
    !Array.isArray(manifest.scenarioPairs) ||
    manifest.scenarioPairs.length !== manifest.scenarioOrder.length
  ) {
    fail("SCENARIO_MEMBERSHIP_MISMATCH")
  }
  const scenarioByCode = new Map(
    preRecruitmentManifest.scenarios.map((scenario) => [scenario.scenarioCode, scenario]),
  )
  for (const [index, pair] of manifest.scenarioPairs.entries()) {
    if (pair.scenarioCode !== manifest.scenarioOrder[index]) {
      fail("SCENARIO_MEMBERSHIP_MISMATCH")
    }
    const scenario = scenarioByCode.get(pair.scenarioCode)
    if (!scenario) {
      fail("SCENARIO_UNKNOWN")
    }
    if (canonicalJson(pair.eligibleArticleIds) !== canonicalJson(scenario.eligibleArticleIds)) {
      fail("ARTICLE_COVERAGE_MISMATCH")
    }
    if (
      !pair.arms ||
      Object.keys(pair.arms).toSorted().join(",") !== "X,Y" ||
      canonicalJson(pair.armMapping) !== canonicalJson(allocation.armMapping) ||
      pair.presentationOrder !== getLabelPresentationOrder(allocation) ||
      pair.randomizedAlgorithmOrder !== allocation.presentationOrder ||
      pair.rendererRevision !== preRecruitmentManifest.rendererRevision
    ) {
      fail("ALLOCATION_MAPPING_MISMATCH")
    }
    assertArmCoverage({ arm: pair.arms.X, pair, preRecruitmentManifest })
    assertArmCoverage({ arm: pair.arms.Y, pair, preRecruitmentManifest })
    if (
      canonicalJson(pairBody(pair)) !== canonicalJson(pairBody(frozenManifest.scenarioPairs[index]))
    ) {
      fail("COMPOSITION_CHANGED_AFTER_FREEZE")
    }
    if (!isHash(pair.pairReceiptHash) || sha256(pairBody(pair)) !== pair.pairReceiptHash) {
      fail("PAIR_HASH_MISMATCH")
    }
  }
  const computedSessionHash = sha256(sessionBody(manifest))
  if (
    !isHash(manifest.sessionManifestHash) ||
    computedSessionHash !== manifest.sessionManifestHash
  ) {
    fail("SESSION_HASH_MISMATCH")
  }
  if (
    manifest.sessionManifestHash !== frozenManifest.sessionManifestHash ||
    canonicalJson(sessionBody(manifest)) !== canonicalJson(sessionBody(frozenManifest))
  ) {
    fail("SESSION_MANIFEST_CHANGED_AFTER_FREEZE")
  }
  return true
}

const responseSchema = parseStrictJson(readFileSync(RESPONSE_SCHEMA_PATH, "utf8"))
const responseSchemaValidator = new Ajv2020({ allErrors: true, strict: false }).compile(
  responseSchema,
)

const schemaFailureCode = () => {
  const errors = responseSchemaValidator.errors ?? []
  if (errors.some(({ keyword }) => keyword === "enum" || keyword === "const")) {
    return "ENUM_INVALID"
  }
  if (errors.some(({ keyword }) => keyword === "propertyNames" || keyword === "pattern")) {
    return "SCHEMA_VALUE_INVALID"
  }
  if (errors.some(({ keyword }) => keyword === "required")) {
    return "SCHEMA_REQUIRED_FIELD_MISSING"
  }
  return "SCHEMA_INVALID"
}

const syntheticArmRating = (sessionManifest, scenarioOrderIndex, armIndex) => ({
  editorialUsefulness: ((sessionManifest.slotIndex + scenarioOrderIndex + armIndex) % 5) + 1,
  confidence: 3,
})

export const createSyntheticResponse = ({
  sessionManifest,
  scenarioPreferences = {},
  overallPreference = null,
  completionStatus = "COMPLETE",
} = {}) => {
  const scenarioRatings = Object.fromEntries(
    sessionManifest.scenarioPairs.map((pair) => [
      pair.scenarioCode,
      {
        pairReceiptHash: pair.pairReceiptHash,
        presentationOrder: pair.presentationOrder,
        scenarioPreference: Object.hasOwn(scenarioPreferences, pair.scenarioCode)
          ? scenarioPreferences[pair.scenarioCode]
          : null,
        X: syntheticArmRating(sessionManifest, pair.scenarioOrderIndex, 0),
        Y: syntheticArmRating(sessionManifest, pair.scenarioOrderIndex, 1),
      },
    ]),
  )
  return {
    schemaVersion: "1.0",
    studyCode: "PERSONALIZATION_HUMAN_RELEVANCE_PILOT_01",
    sessionCode: sessionManifest.sessionCode,
    consentAccepted: true,
    completionStatus,
    sessionManifestHash: sessionManifest.sessionManifestHash,
    studyOnlyPreferenceSeedKeys: [...sessionManifest.profileSeedReferences.keys],
    scenarioRatings,
    overallPreference,
    allocationKey: sessionManifest.allocationKey,
    optionalRationale: null,
  }
}

const getResponseObject = (response) =>
  typeof response === "string" ? parseStrictJson(response) : response

export const validateSyntheticResponse = ({
  response,
  sessionManifest,
  preRecruitmentManifest,
  allocation,
} = {}) => {
  const record = getResponseObject(response)
  if (!responseSchemaValidator(record)) {
    fail(schemaFailureCode())
  }
  validateSessionManifest({
    manifest: sessionManifest,
    frozenManifest: sessionManifest,
    preRecruitmentManifest,
    allocation,
  })
  if (
    record.sessionCode !== sessionManifest.sessionCode ||
    record.sessionManifestHash !== sessionManifest.sessionManifestHash
  ) {
    fail("SESSION_MANIFEST_MISMATCH")
  }
  if (record.allocationKey !== sessionManifest.allocationKey) {
    fail("ALLOCATION_KEY_MISMATCH")
  }
  if (
    canonicalJson(record.studyOnlyPreferenceSeedKeys ?? []) !==
    canonicalJson(sessionManifest.profileSeedReferences.keys)
  ) {
    fail("PROFILE_PREFERENCES_CHANGED")
  }
  const globalScenarioCodes = new Set(
    preRecruitmentManifest.scenarios.map(({ scenarioCode }) => scenarioCode),
  )
  const scheduledScenarioCodes = new Set(sessionManifest.scenarioOrder)
  const { scenarioRatings } = record
  for (const scenarioCode of Object.keys(scenarioRatings)) {
    if (!globalScenarioCodes.has(scenarioCode)) {
      fail("SCENARIO_UNKNOWN")
    }
    if (!scheduledScenarioCodes.has(scenarioCode)) {
      fail("SCENARIO_NOT_SCHEDULED")
    }
  }
  if (record.completionStatus === "COMPLETE") {
    const submitted = Object.keys(scenarioRatings).toSorted()
    const expected = [...sessionManifest.scenarioOrder].toSorted()
    if (canonicalJson(submitted) !== canonicalJson(expected)) {
      fail("COMPLETE_SCENARIO_SET_MISMATCH")
    }
  }
  const pairByScenario = new Map(
    sessionManifest.scenarioPairs.map((pair) => [pair.scenarioCode, pair]),
  )
  for (const [scenarioCode, rating] of Object.entries(scenarioRatings)) {
    const pair = pairByScenario.get(scenarioCode)
    if (!pair) {
      fail("SCENARIO_NOT_SCHEDULED")
    }
    if (rating.pairReceiptHash !== pair.pairReceiptHash) {
      fail("PAIR_RECEIPT_HASH_MISMATCH")
    }
    if (rating.presentationOrder !== pair.presentationOrder) {
      fail("PRESENTATION_ORDER_MISMATCH")
    }
    if (!PREFERENCE_VALUES.has(rating.scenarioPreference)) {
      fail("ENUM_INVALID")
    }
  }
  return record
}

const countValues = (values) => {
  const counts = {}
  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1
  }
  return Object.fromEntries(
    Object.entries(counts).toSorted(([left], [right]) => left.localeCompare(right)),
  )
}

const createBaseReconciliation = ({ sessionManifests, allocations }) => {
  validateAllocationSchedule(allocations, sessionManifests.length)
  if (allocations.length !== sessionManifests.length) {
    fail("ALLOCATION_MANIFEST_COUNT_MISMATCH")
  }
  const allocationByKey = new Map(
    allocations.map((allocation) => [allocation.allocationKey, allocation]),
  )
  const manifestByKey = new Map(
    sessionManifests.map((manifest) => [manifest.allocationKey, manifest]),
  )
  if (
    allocationByKey.size !== allocations.length ||
    manifestByKey.size !== sessionManifests.length
  ) {
    fail("ALLOCATION_KEY_REUSED")
  }
  return { allocationByKey, manifestByKey }
}

export const reconcileSyntheticExport = ({
  rawExportText,
  sessionManifests,
  allocations,
  preRecruitmentManifest,
} = {}) => {
  const parsedExport = parseStrictJson(rawExportText)
  if (parsedExport?.fixtureKind !== "SYNTHETIC_ONLY" || !Array.isArray(parsedExport.responses)) {
    fail("SYNTHETIC_EXPORT_INVALID")
  }
  validatePreRecruitmentManifest(preRecruitmentManifest)
  const { allocationByKey, manifestByKey } = createBaseReconciliation({
    sessionManifests,
    allocations,
  })
  let sessionHashesVerified = 0
  let pairHashesVerified = 0
  for (const sessionManifest of sessionManifests) {
    const allocation = allocationByKey.get(sessionManifest.allocationKey)
    validateSessionManifest({
      manifest: sessionManifest,
      frozenManifest: sessionManifest,
      preRecruitmentManifest,
      allocation,
    })
    sessionHashesVerified += 1
    pairHashesVerified += sessionManifest.scenarioPairs.length
  }

  const usedAllocationKeys = new Set()
  const validResponses = []
  const rejectedResponses = []
  const rejectionReasons = {}
  let submittedPairCount = 0
  let acceptedPairCount = 0
  const scenarioPreferences = []
  const overallPreferences = []
  for (const [rowIndex, response] of parsedExport.responses.entries()) {
    submittedPairCount += Object.keys(response?.scenarioRatings ?? {}).length
    let errorCode = null
    try {
      const allocationKey = response?.allocationKey
      if (usedAllocationKeys.has(allocationKey)) {
        fail("ALLOCATION_KEY_REUSED")
      }
      usedAllocationKeys.add(allocationKey)
      const sessionManifest = manifestByKey.get(allocationKey)
      const allocation = allocationByKey.get(allocationKey)
      if (!sessionManifest || !allocation) {
        fail("ALLOCATION_KEY_UNKNOWN")
      }
      const validated = validateSyntheticResponse({
        response,
        sessionManifest,
        preRecruitmentManifest,
        allocation,
      })
      validResponses.push(validated)
      acceptedPairCount += Object.keys(validated.scenarioRatings).length
      scenarioPreferences.push(
        ...Object.values(validated.scenarioRatings).map(
          ({ scenarioPreference }) => scenarioPreference,
        ),
      )
      overallPreferences.push(validated.overallPreference)
    } catch (error) {
      errorCode = error instanceof PilotRehearsalError ? error.code : "VALIDATION_INTERNAL_ERROR"
      rejectedResponses.push({ rowIndex, errorCode })
      rejectionReasons[errorCode] = (rejectionReasons[errorCode] ?? 0) + 1
    }
  }
  const algorithmOrderBalance = countValues(
    allocations.map(({ presentationOrder }) => presentationOrder),
  )
  const labelOrderBalance = countValues(
    allocations.map((allocation) => getLabelPresentationOrder(allocation)),
  )
  const jointOrderCoverage = countValues(
    allocations.map(
      (allocation) => `${allocation.presentationOrder}|${getLabelPresentationOrder(allocation)}`,
    ),
  )
  return {
    fixtureKind: "SYNTHETIC_ONLY",
    referenceBaseSha: preRecruitmentManifest.referenceBaseSha,
    preRecruitmentManifestHash: preRecruitmentManifest.manifestHash,
    sessionCount: sessionManifests.length,
    submittedResponseCount: parsedExport.responses.length,
    validResponseCount: validResponses.length,
    rejectedResponseCount: rejectedResponses.length,
    rejectionReasons: Object.fromEntries(
      Object.entries(rejectionReasons).toSorted(([left], [right]) => left.localeCompare(right)),
    ),
    submittedPairCount,
    acceptedPairCount,
    algorithmOrderBalance,
    labelOrderBalance,
    jointOrderCoverage,
    scenarioPreferenceStates: countValues(
      scenarioPreferences.map((value) => (value === null ? "OMITTED" : value)),
    ),
    overallPreferenceStates: countValues(
      overallPreferences.map((value) => (value === null ? "OMITTED" : value)),
    ),
    sessionHashesVerified,
    pairHashesVerified,
    assignmentMappingLeakedToResponseExport: parsedExport.responses.some((response) =>
      Object.hasOwn(response ?? {}, "armMapping"),
    ),
    sourceAndCategoryIdentityPreserved: true,
    humanRelevanceMeasured: false,
    limeSurveyIntegrationGate: "NOT_TESTED",
    validResponseRows: validResponses.length,
    rejectedRows: rejectedResponses,
  }
}

const readFixture = (filename) =>
  parseStrictJson(readFileSync(new URL(filename, REHEARSAL_FIXTURE_DIRECTORY), "utf8"))

export const buildDummyRehearsal = ({ stimuli, allocationFixture, sessionPlan }) => {
  if (allocationFixture?.fixtureKind !== "SYNTHETIC_ONLY" || allocationFixture.frozen !== true) {
    fail("ALLOCATION_FIXTURE_NOT_FROZEN_SYNTHETIC")
  }
  if (
    allocationFixture.generatedBy !==
      "node:crypto.randomBytes+randomInt (session and allocation keys)" ||
    allocationFixture.assignmentSelection !== "DETERMINISTIC_2X2_COVERAGE" ||
    allocationFixture.representativeOfOperationalRandomization !== false
  ) {
    fail("ALLOCATION_FIXTURE_RANDOMNESS_UNVERIFIED")
  }
  const preRecruitmentManifest = createPreRecruitmentManifest(stimuli)
  validateAllocationSchedule(allocationFixture.assignments)
  const sessionManifests = allocationFixture.assignments.map((allocation) => {
    const choice = sessionPlan.sessionChoices.find(
      ({ slotIndex }) => slotIndex === allocation.slotIndex,
    )
    if (!choice) {
      fail("SYNTHETIC_SESSION_PLAN_MISSING")
    }
    return createSessionManifest({
      preRecruitmentManifest,
      allocation,
      profileSeedKeys: choice.profileSeedKeys,
    })
  })
  const responsePlanBySlot = new Map(sessionPlan.responsePlan.map((item) => [item.slotIndex, item]))
  const responses = sessionManifests.map((sessionManifest) => {
    const responsePlan = responsePlanBySlot.get(sessionManifest.slotIndex)
    if (!responsePlan) {
      fail("SYNTHETIC_RESPONSE_PLAN_MISSING")
    }
    const response = createSyntheticResponse({
      sessionManifest,
      scenarioPreferences: responsePlan.scenarioPreferences,
      overallPreference: responsePlan.overallPreference,
      completionStatus: responsePlan.completionStatus,
    })
    if (responsePlan.tamper === "PAIR_RECEIPT_HASH") {
      response.scenarioRatings[sessionManifest.scenarioOrder[0]].pairReceiptHash = "0".repeat(64)
    }
    return response
  })
  const exportDocument = { fixtureKind: "SYNTHETIC_ONLY", responses }
  const rawExportText = JSON.stringify(exportDocument)
  const reconciliation = reconcileSyntheticExport({
    rawExportText,
    sessionManifests,
    allocations: allocationFixture.assignments,
    preRecruitmentManifest,
  })
  const report = {
    reportVersion: "PERSONALIZATION_PILOT_DUMMY_REHEARSAL_01_V2",
    fixtureKind: "SYNTHETIC_ONLY",
    generatedFromFrozenFixtures: true,
    referenceBaseSha: preRecruitmentManifest.referenceBaseSha,
    preRecruitmentManifestHash: preRecruitmentManifest.manifestHash,
    sessionCount: reconciliation.sessionCount,
    pairCount: sessionManifests.reduce(
      (count, manifest) => count + manifest.scenarioPairs.length,
      0,
    ),
    validResponseCount: reconciliation.validResponseCount,
    rejectedResponseCount: reconciliation.rejectedResponseCount,
    rejectionReasons: reconciliation.rejectionReasons,
    algorithmOrderBalance: reconciliation.algorithmOrderBalance,
    labelOrderBalance: reconciliation.labelOrderBalance,
    jointOrderCoverage: reconciliation.jointOrderCoverage,
    scenarioPreferenceStates: reconciliation.scenarioPreferenceStates,
    overallPreferenceStates: reconciliation.overallPreferenceStates,
    sessionHashesVerified: reconciliation.sessionHashesVerified,
    pairHashesVerified: reconciliation.pairHashesVerified,
    articleCoverageVerified: true,
    sourceAndCategoryIdentityPreserved: true,
    blindingPreserved: !reconciliation.assignmentMappingLeakedToResponseExport,
    humanRelevanceMeasured: false,
    limeSurveyIntegrationGate: "NOT_TESTED",
    externalDataTransfer: false,
    minifluxAccess: false,
    productChanges: false,
  }
  return {
    preRecruitmentManifest,
    sessionManifests,
    exportDocument,
    rawExportText,
    reconciliation,
    report,
  }
}

export const runDummyRehearsalFromFrozenFixtures = () =>
  buildDummyRehearsal({
    stimuli: readFixture("personalization-pilot-dummy-stimuli-01.json"),
    allocationFixture: readFixture("personalization-pilot-dummy-allocation-01.json"),
    sessionPlan: readFixture("personalization-pilot-dummy-session-plan-01.json"),
  })
