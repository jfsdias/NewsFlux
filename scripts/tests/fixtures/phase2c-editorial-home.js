export const fixtureFeed = {
  id: 1,
  icon: { icon_id: 991 },
  title: "Local routing fixture",
  site_url: "https://example.invalid",
  feed_url: "https://example.invalid/feed",
  category: { id: 1, title: "Local category" },
}

export const routeEntries = [101, 202].map((id) => ({
  id,
  title: `Home route article ${id}`,
  published_at: "2026-10-12T10:00:00Z",
  created_at: "2026-10-12T10:00:00Z",
  changed_at: "2026-10-12T10:00:00Z",
  status: "unread",
  starred: false,
  url: `https://example.invalid/${id}`,
  hash: `route-${id}`,
  content: `<p>Local deterministic reader content for article ${id}.</p>`,
  reading_time: 1,
  comments_url: "",
  enclosures: [],
  feed: fixtureFeed,
}))

// Deliberately unsorted, with a duplicate and a read record: only entry ID dedupes Home.
const highlightEntry = (id, hour, feedId = 1, categoryId = 1, image = false) => ({
  ...routeEntries[0],
  id,
  title: `Highlight article ${id}`,
  published_at: `2026-10-12T${hour}:00:00Z`,
  url: `https://example.invalid/${id}`,
  hash: `highlight-${id}`,
  content: `<p>Local deterministic reader content for article ${id}.</p>${image ? `<img src="${globalThis.location.origin}/scripts/tests/fixtures/valid-hero.svg" width="960" height="540" />` : ""}`,
  feed: {
    ...fixtureFeed,
    id: feedId,
    title: `Source ${feedId}`,
    category: { id: categoryId, title: `Category ${categoryId}` },
  },
})

const primary = highlightEntry(101, "12", 1, 1, true)
const secondary1 = { ...highlightEntry(202, "11", 2, 2), starred: true }
const secondary2 = highlightEntry(303, "10", 3, 3, true)
export const highlightFixtures = {
  image: [
    secondary2,
    primary,
    secondary1,
    highlightEntry(404, "09"),
    { ...primary },
    { ...highlightEntry(505, "13"), status: "read" },
  ],
  textOnly: [highlightEntry(101, "12"), secondary1, secondary2],
  two: [primary, secondary1],
  one: [primary],
  shared: [highlightEntry(101, "12"), highlightEntry(202, "11"), highlightEntry(303, "10")],
}

const personalizationEntry = (id, minutesAfterNoon, feedId, categoryId) => ({
  ...routeEntries[0],
  id,
  title: `Personalization article ${id}`,
  published_at: new Date(Date.UTC(2026, 9, 12, 12, minutesAfterNoon)).toISOString(),
  url: `https://example.invalid/${id}`,
  hash: `personalization-${id}`,
  feed: {
    ...fixtureFeed,
    id: feedId,
    title: `Personalization source ${feedId}`,
    category: { id: categoryId, title: `Personalization category ${categoryId}` },
  },
})

export const personalizationFixtures = {
  home: [
    personalizationEntry(601, 0, 1, 1),
    personalizationEntry(602, -10, 2, 2),
    personalizationEntry(603, -20, 3, 3),
    personalizationEntry(604, -30, 4, 4),
  ],
  preferredProfile: [
    { ...personalizationEntry(603, -20, 3, 3), starred: true },
    { ...personalizationEntry(999, -25, 3, 3), starred: true },
  ],
  unchangedProfile: [{ ...personalizationEntry(602, -10, 2, 2), starred: true }],
  noMatchProfile: [{ ...personalizationEntry(999, -20, 99, 99), starred: true }],
  hiddenOnlyProfile: [{ ...personalizationEntry(998, -20, 99, 99), starred: true }],
  directStarOutsideSampleHome: [
    personalizationEntry(601, 0, 1, 1),
    personalizationEntry(602, -10, 2, 2),
    personalizationEntry(603, -20, 3, 3),
    { ...personalizationEntry(604, -30, 4, 4), starred: true },
  ],
}

// Unique timestamps make the existing overlap cursor deterministic across large pages.
export const paginationEntries = (count, offset = 0) =>
  Array.from({ length: count }, (_, index) => {
    const position = offset + index
    const id = 10_000 + position
    return {
      ...routeEntries[0],
      id,
      title: "Shared editorial title",
      hash: "shared-pagination-hash",
      url: "https://example.invalid/shared-pagination-url",
      published_at: new Date(Date.UTC(2026, 9, 12, 12) - position * 60_000).toISOString(),
      content: `<p>Local pagination article ${id}.</p>`,
    }
  })

export const emptyHomeFixtures = {
  zeroUnread: { entries: [], total: 0 },
  emptyPageWithMore: {
    entries: [],
    total: 12,
    nextPage: paginationEntries(12),
  },
}

export const phase2cEditorialHomeMatrix = {
  viewports: [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 884, height: 1104 },
    { width: 1024, height: 768 },
    { width: 1280, height: 800 },
    { width: 1440, height: 900 },
  ],
  themes: ["light", "dark"],
  automatedGates: [
    "HARNESS_SCENARIO_MATRIX_COMPLETE",
    "HOME_FIRST_SECTION_CLEAR_OF_CHROME",
    "HOME_NO_OVERFLOW",
    "HOME_SECTION_HIERARCHY",
    "HOME_PRIMARY_TEXT_ONLY",
    "HOME_SECONDARY_LAYOUT",
    "HOME_RECENT_GRID",
    "HOME_EMPTY_RECENT",
    "HOME_LOADING",
    "HOME_REFRESH_ERROR_WITH_CONTENT",
    "HOME_LIGHT",
    "HOME_DARK",
    "HOME_IDENTITY_FAILURE_RECOVERY",
    "HOME_LAST_READ_TRANSITIONS_TO_TUDO_EM_DIA",
    "HOME_READ_FAILURE_DOES_NOT_ZERO_TOTAL",
    "HOME_MARK_UNREAD_RECONCILES_TOTAL",
    "HOME_UNLOADED_MARK_UNREAD_REENABLES_PAGINATION",
    "HOME_TOTAL_RECONCILIATION_STALE_SESSION_PROTECTED",
    "CANONICAL_HOME_QUERY_UNCHANGED",
    "NO_SECOND_CANDIDATE_STREAM",
    "PERSONALIZATION_EXPLAINER_TRUTHFUL",
    "PROFILE_DEADLINE_FALLBACK_NO_RECOMPOSE",
    "STALE_SESSION_PROFILE_DISCARDED",
    "EXPLICIT_REFRESH_SINGLE_RECOMPOSITION",
    "ONE_AUX_PROFILE_QUERY_PER_HOME_SESSION",
    "ALL_UNREAD_UNCHANGED",
    "HOME_VISUAL_01_CASE_A_TEXT_PRIMARY_IMAGE_SECONDARIES",
    "HOME_VISUAL_01_CASE_B_ALL_IMAGES",
    "HOME_VISUAL_01_CASE_C_ALL_TEXT",
    "HOME_VISUAL_01_CASE_D_LONG_PRIMARY_TITLE",
    "HOME_VISUAL_01_CASE_E_SHORT_PRIMARY_STRONG_SECONDARIES",
  ],
  scenarios: [
    {
      id: "THREE_PLUS_UNREAD_WITH_IMAGE_PRIMARY",
      covers: ["HOME_PRIMARY_NEWEST", "HOME_MAX_THREE_HIGHLIGHTS"],
      fixtures: ["highlightFixtures.image"],
    },
    {
      id: "THREE_PLUS_UNREAD_WITH_TEXT_ONLY_PRIMARY",
      covers: ["HOME_PRIMARY_TEXT_ONLY", "HOME_MAX_THREE_HIGHLIGHTS"],
      fixtures: ["highlightFixtures.textOnly"],
    },
    {
      id: "TWO_UNREAD",
      covers: ["HOME_LOW_UNREAD_COUNTS"],
      fixtures: ["highlightFixtures.two"],
    },
    {
      id: "ONE_UNREAD",
      covers: ["HOME_LOW_UNREAD_COUNTS"],
      fixtures: ["highlightFixtures.one"],
    },
    {
      id: "ZERO_UNREAD",
      covers: ["HOME_ZERO_UNREAD"],
      fixtures: ["emptyHomeFixtures.zeroUnread"],
    },
    {
      id: "MIXED_IMAGE_AND_TEXT_ONLY",
      covers: ["HOME_PRIMARY_NEWEST", "HOME_SECONDARIES_BALANCED_ORDER"],
      fixtures: ["highlightFixtures.image"],
    },
    {
      id: "DIVERSE_SOURCE_AND_CATEGORY",
      covers: ["HOME_SECONDARIES_BALANCED_ORDER"],
      fixtures: ["highlightFixtures.image"],
    },
    {
      id: "SAME_SOURCE_AND_CATEGORY",
      covers: ["HOME_SECONDARIES_BALANCED_ORDER"],
      fixtures: ["highlightFixtures.shared"],
    },
    { id: "LOADING", covers: ["HOME_LOADING"], fixtures: ["deferredArticleQuery"] },
    { id: "INITIAL_ERROR", covers: ["HOME_INITIAL_ERROR"], fixtures: ["queryError"] },
    {
      id: "REFRESH_ERROR_RETAINS_CONTENT",
      covers: ["HOME_REFRESH_ERROR_WITH_CONTENT"],
      fixtures: ["highlightFixtures.image", "articleFailure"],
    },
    { id: "LOAD_MORE_ERROR", covers: ["HOME_LOAD_MORE_ERROR"], fixtures: ["failPagination"] },
    {
      id: "AFTER_READ_BACKFILL",
      covers: ["HOME_REJECTED_UNREAD_REVERSAL_RECONCILES_CONFIRMED_READ"],
      fixtures: ["deferredFirstStatusMutation", "rejectStatusMutationCall"],
    },
    {
      id: "AFTER_MARK_UNREAD",
      covers: [
        "HOME_MARK_UNREAD_RECONCILES_TOTAL",
        "HOME_UNLOADED_MARK_UNREAD_REENABLES_PAGINATION",
      ],
      fixtures: ["unloadedStatus"],
    },
    {
      id: "AFTER_STAR_AND_UNSTAR",
      covers: ["HOME_HIGHLIGHT_ACTIONS"],
      fixtures: ["starMutationRequests"],
    },
    {
      id: "PHASE2D_PERSONALIZED_PROJECTION",
      covers: ["CANONICAL_HOME_QUERY_UNCHANGED", "NO_SECOND_CANDIDATE_STREAM"],
      fixtures: ["personalizationFixtures.home", "personalizationFixtures.preferredProfile"],
    },
    {
      id: "PHASE2D_TRUTHFUL_EXPLAINER_AND_FALLBACKS",
      covers: ["PERSONALIZATION_EXPLAINER_TRUTHFUL"],
      fixtures: [
        "personalizationFixtures.noMatchProfile",
        "personalizationFixtures.hiddenOnlyProfile",
      ],
    },
    {
      id: "PHASE2D_DEADLINE_AND_STALE_PROFILE",
      covers: ["PROFILE_DEADLINE_FALLBACK_NO_RECOMPOSE", "STALE_SESSION_PROFILE_DISCARDED"],
      fixtures: ["deferredStarredProfile"],
    },
    {
      id: "PHASE2D_EXPLICIT_REFRESH",
      covers: ["EXPLICIT_REFRESH_SINGLE_RECOMPOSITION"],
      fixtures: ["canonical snapshot refresh", "changed profile order"],
    },
    {
      id: "PHASE2D_QUERY_SCOPE_AND_SESSION",
      covers: ["ONE_AUX_PROFILE_QUERY_PER_HOME_SESSION"],
      fixtures: ["load more", "star/unstar", "status settlement", "reader return"],
    },
    {
      id: "PHASE2D_NON_HOME_LISTS",
      covers: ["ALL_UNREAD_UNCHANGED"],
      fixtures: ["All", "Unread"],
    },
    {
      id: "HOME_VISUAL_01_PRIMARY_HIERARCHY",
      covers: [
        "HOME_VISUAL_01_CASE_A_TEXT_PRIMARY_IMAGE_SECONDARIES",
        "HOME_VISUAL_01_CASE_B_ALL_IMAGES",
        "HOME_VISUAL_01_CASE_C_ALL_TEXT",
        "HOME_VISUAL_01_CASE_D_LONG_PRIMARY_TITLE",
        "HOME_VISUAL_01_CASE_E_SHORT_PRIMARY_STRONG_SECONDARIES",
      ],
      fixtures: ["primaryHierarchyFixtures"],
    },
  ],
  manualGates: [
    "EDITORIAL_HIERARCHY_CLEAR",
    "PRIMARY_NOT_OVERSIZED",
    "SECONDARIES_BALANCED",
    "RECENT_VISIBLE_AS_CONTINUATION",
    "TEXT_ONLY_PRIMARY_FEELS_INTENTIONAL",
    "NO_GLASS_CONTENT_SURFACES",
    "OLED_SURFACE_SEPARATION",
    "NO_LAYOUT_JUMP_ON_READER_RETURN",
    "NO_UNEXPECTED_RECOMPOSE",
    "TOUCH_TARGETS_USABLE",
    "MOBILE_SINGLE_PANE",
  ].map((name) => ({ name, status: "MANUAL_REQUIRED" })),
}

// HOME-VISUAL-01 visual cases. Distinct sources and categories keep the frozen
// Phase 2C selection obvious: the newest entry is Primary, the next two are Secondaries.
const hierarchyImage = (file) =>
  `<img src="${globalThis.location.origin}/scripts/tests/fixtures/${file}" width="1600" height="900" />`
const hierarchyEntry = (id, hour, { image = null, title = `Hierarchy article ${id}` } = {}) => ({
  ...highlightEntry(id, hour, id, id),
  title,
  hash: `hierarchy-${id}`,
  content: `${image ? hierarchyImage(image) : ""}<p>Deterministic editorial deck for article ${id} explains the story in one plain sentence. A second sentence adds supporting context for the reader.</p>`,
})
const HERO = "valid-hero.svg"
const STRONG = "strong-secondary.svg"
const hierarchyRecent = (base) => [
  hierarchyEntry(base + 4, "09", { image: HERO }),
  hierarchyEntry(base + 5, "08"),
  hierarchyEntry(base + 6, "07", { image: HERO }),
]
export const primaryHierarchyFixtures = {
  caseA: [
    hierarchyEntry(701, "12", { title: "Council approves the regional transit plan" }),
    hierarchyEntry(702, "11", {
      image: STRONG,
      title: "Harbour festival returns with a new route",
    }),
    hierarchyEntry(703, "10", {
      image: STRONG,
      title: "Researchers map the deepest coral reef yet",
    }),
    ...hierarchyRecent(700),
  ],
  caseB: [
    hierarchyEntry(711, "12", { image: HERO, title: "Council approves the regional transit plan" }),
    hierarchyEntry(712, "11", {
      image: STRONG,
      title: "Harbour festival returns with a new route",
    }),
    hierarchyEntry(713, "10", { image: HERO, title: "Researchers map the deepest coral reef yet" }),
    ...hierarchyRecent(710),
  ],
  caseC: [
    hierarchyEntry(721, "12", { title: "Council approves the regional transit plan" }),
    hierarchyEntry(722, "11", { title: "Harbour festival returns with a new route" }),
    hierarchyEntry(723, "10", { title: "Researchers map the deepest coral reef yet" }),
    ...hierarchyRecent(720),
  ],
  caseD: [
    hierarchyEntry(731, "12", {
      title:
        "After months of negotiation, the regional council approves a transit plan that rebuilds three rail lines, adds night buses and changes how fares are shared across every town in the valley",
    }),
    hierarchyEntry(732, "11", {
      image: STRONG,
      title: "Harbour festival returns with a new route",
    }),
    hierarchyEntry(733, "10", {
      image: STRONG,
      title: "Researchers map the deepest coral reef yet",
    }),
    ...hierarchyRecent(730),
  ],
  caseE: [
    hierarchyEntry(741, "12", { title: "Rates hold" }),
    hierarchyEntry(742, "11", {
      image: STRONG,
      title: "Harbour festival returns with a new route through the old docks and a night parade",
    }),
    hierarchyEntry(743, "10", {
      image: STRONG,
      title: "Researchers map the deepest coral reef yet, finding species never recorded before",
    }),
    ...hierarchyRecent(740),
  ],
}
