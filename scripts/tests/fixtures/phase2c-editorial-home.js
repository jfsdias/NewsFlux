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
    "HOME_SESSION_STABLE_AFTER_READER_READ",
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
    "READER_VISUAL_01_SHORT",
    "READER_VISUAL_01_LONG_FORM_TECHNICAL_SURFACES",
    "READER_VISUAL_01_LONG_HEADLINE",
    "READER_VISUAL_01_WIDE_IMAGE",
    "READER_VISUAL_01_PORTRAIT_IMAGE",
    "READER_VISUAL_01_NO_IMAGE",
    "READER_VISUAL_01_ARTICLE_WIDTH_50_75_100",
    "READER_VISUAL_01_SCROLL_UNDER_GLASS",
    "READER_VISUAL_02A1_NORMAL",
    "READER_VISUAL_02A1_STRESS",
    "READER_VISUAL_02A1_TECHNICAL",
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
      id: "AFTER_CONFIRMED_READ_STABLE_SESSION",
      covers: [
        "HOME_REJECTED_UNREAD_REVERSAL_RECONCILES_CONFIRMED_READ",
        "HOME_SESSION_STABLE_AFTER_READER_READ",
      ],
      fixtures: ["reader mark-as-read", "deferredFirstStatusMutation", "rejectStatusMutationCall"],
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
      id: "PHASE2D_SESSION_STABILITY",
      covers: ["HOME_SESSION_STABLE_AFTER_READER_READ"],
      fixtures: [
        "open unread Primary",
        "normal read settlement",
        "close reader",
        "exact IDs/order",
      ],
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
    {
      id: "READER_VISUAL_01_READING_ERGONOMICS",
      covers: [
        "READER_VISUAL_01_SHORT",
        "READER_VISUAL_01_LONG_FORM_TECHNICAL_SURFACES",
        "READER_VISUAL_01_LONG_HEADLINE",
        "READER_VISUAL_01_WIDE_IMAGE",
        "READER_VISUAL_01_PORTRAIT_IMAGE",
        "READER_VISUAL_01_NO_IMAGE",
        "READER_VISUAL_01_ARTICLE_WIDTH_50_75_100",
        "READER_VISUAL_01_SCROLL_UNDER_GLASS",
      ],
      fixtures: ["readerFixtures"],
    },
    {
      id: "READER_VISUAL_02A1_EDITORIAL_TYPOGRAPHY",
      covers: [
        "READER_VISUAL_02A1_NORMAL",
        "READER_VISUAL_02A1_STRESS",
        "READER_VISUAL_02A1_TECHNICAL",
      ],
      fixtures: ["readerTypographyFixtures"],
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

// READER-VISUAL-01 reader fixtures: ordinary prose plus the technical and media
// surfaces that must keep the reader frame width while prose narrows.
const readerAsset = (file) => `${globalThis.location.origin}/scripts/tests/fixtures/${file}`
const readerParagraph = (n) =>
  `<p>Paragraph ${n} carries enough ordinary prose to wrap across several lines at every reader width, so the measure, the line height and the paragraph rhythm can be judged on real sentences rather than on single words. A second sentence keeps the block long enough to show the right edge of the column.</p>`
const readerParagraphs = (count, offset = 0) =>
  Array.from({ length: count }, (_, index) => readerParagraph(offset + index + 1)).join("")
const readerEntry = (id, title, content) => ({
  ...routeEntries[0],
  id,
  title,
  hash: `reader-${id}`,
  url: `https://example.invalid/reader/${id}`,
  content,
  reading_time: 6,
})
export const readerFixtures = {
  short: readerEntry(901, "A short reader article", readerParagraphs(2)),
  longForm: readerEntry(
    902,
    "A long-form reader article with technical surfaces",
    [
      readerParagraphs(3),
      "<h2>Section heading inside the article</h2>",
      readerParagraphs(2, 3),
      "<ul><li>First list item with a few words of explanation.</li><li>Second list item that is a little longer so it wraps at narrow widths.</li></ul>",
      "<blockquote><p>A quoted passage stays inside the prose column and keeps its own indentation.</p></blockquote>",
      "<h3>Technical surfaces</h3>",
      "<pre><code>const readerFrame = settings.articleWidth\nconst proseMeasure = readerFrame * 0.75 // characters, before the frame cap\nconsole.log({ readerFrame, proseMeasure, note: 'code keeps the full reader frame width' })</code></pre>",
      "<table><thead><tr><th>Surface</th><th>Width</th><th>Reason</th></tr></thead><tbody><tr><td>Prose</td><td>75% of Article width</td><td>Comfortable line length</td></tr><tr><td>Media, code, tables</td><td>Article width</td><td>Room for wide content</td></tr></tbody></table>",
      '<iframe src="about:blank" title="Embedded media fixture"></iframe>',
      readerParagraphs(6, 5),
    ].join(""),
  ),
  longHeadline: readerEntry(
    903,
    "After months of negotiation, the regional council approves a transit plan that rebuilds three rail lines, adds night buses and changes how fares are shared across every town in the valley",
    readerParagraphs(3),
  ),
  wideImage: readerEntry(
    904,
    "A reader article with a wide image",
    `<p><img src="${readerAsset("valid-hero.svg")}" width="1600" height="900" /></p>${readerParagraphs(2)}<figure><img src="${readerAsset("valid-horizontal.svg")}" width="1600" height="900" /><figcaption>A figure caption under a wide image stays with the image.</figcaption></figure>${readerParagraphs(2, 2)}`,
  ),
  portraitImage: readerEntry(
    905,
    "A reader article with a portrait image",
    `${readerParagraphs(1)}<p><img src="${readerAsset("valid-vertical.svg")}" width="600" height="1000" /></p>${readerParagraphs(3, 1)}`,
  ),
  noImage: readerEntry(
    906,
    "A reader article without images",
    `${readerParagraphs(2)}<h2>Plain section</h2>${readerParagraphs(3, 2)}`,
  ),
}

// READER-VISUAL-02A1: typography fixtures. Source markup stresses the editorial scale: a former h1 (normalized to
// h2 by A11Y-01), nested headings, links before punctuation, lists, quotes, inline code, long paths, footnotes
// and technical surfaces. Dates and feeds stay fixed: this slice does not touch the header.
const typographyEntry = (id, title, content, extra) => ({
  ...readerEntry(id, title, content),
  ...extra,
})
const typographyFeed = (id, title, categoryTitle) => ({
  ...fixtureFeed,
  id,
  title,
  category: { id, title: categoryTitle },
})
export const readerTypographyFixtures = {
  typographyNormal: typographyEntry(
    931,
    "City council approves €4.2 billion plan to rebuild the waterfront",
    [
      `<figure><img src="${readerAsset("valid-hero.svg")}" width="1600" height="900" alt="" /><figcaption>Caption under the hero image, kept as is by this slice.</figcaption></figure>`,
      `<p><strong>LISBON —</strong> After nine hours of debate the council voted 24 to 17 on Tuesday, according to <a href="https://example.invalid/report">the council’s report</a>, to approve a <em>€4.2 billion</em> package.</p>`,
      `<p>Links before punctuation: see <a href="https://example.invalid/a">the fund</a>, the <a href="https://example.invalid/b">tram line</a>, and <a href="https://example.invalid/c">the budget</a>.</p>`,
      "<h2>What changes for residents</h2>",
      readerParagraphs(1),
      "<h3>The cost question</h3>",
      readerParagraphs(1, 1),
      "<h4>A smaller heading</h4>",
      readerParagraphs(1, 2),
      "<blockquote><p>We have spent fifty years designing the city around the car and then wondering why nobody wants to walk in it.</p></blockquote>",
      "<blockquote><p>A longer quoted passage that comes from a forum thread and keeps going for a while so that the quote spans more than one line.</p><p>A second paragraph inside the same quote.</p></blockquote>",
      `<ul><li>First item with <a href="https://example.invalid/d">a link</a> and <code>inlineCode()</code>.<ul><li>Nested item one</li><li>Nested item two</li></ul></li><li>Second item that is a little longer so it wraps at narrow widths and shows the item spacing.</li><li>Third item</li></ul>`,
      "<ol><li>Step one</li><li>Step two with <strong>strong</strong> and <em>emphasis</em></li></ol>",
      readerParagraphs(1, 3),
    ].join(""),
    {
      author: "Maria Santos",
      feed: typographyFeed(21, "The Daily Ledger", "News"),
      reading_time: 7,
    },
  ),
  typographyStress: typographyEntry(
    932,
    "A very long headline that keeps going well past what any editor would approve because the feed publishes the whole sentence as the title and then adds a second clause that nobody asked for",
    [
      "<h1>An h1 inside the article body</h1>",
      "<h2>An h2 immediately after</h2>",
      readerParagraphs(1),
      `<p>A very long link: <a href="https://example.invalid/a/very/long/path/that/never/breaks/because/it/has/no/spaces/and/keeps/going/and/going">https://example.invalid/a/very/long/path/that/never/breaks/because/it/has/no/spaces/and/keeps/going/and/going</a> ends here.</p>`,
      "<h3>An h3</h3>",
      readerParagraphs(1, 1),
      "<h4>An h4</h4>",
      "<h5>An h5</h5>",
      "<h6>An h6</h6>",
      readerParagraphs(1, 2),
      "<blockquote><h2>A nested h2 inside a quote</h2><p>Quoted text.</p></blockquote>",
      "<ul><li><h1>A nested h1 inside a list item</h1></li></ul>",
      "<table><tbody><tr><td><h2>A nested h2 in a cell</h2></td></tr></tbody></table>",
    ].join(""),
    {
      author: "Alexandria Montgomery-Fitzgerald and Christopher Vandenberghe-Okonkwo",
      feed: typographyFeed(
        22,
        "The International Journal of Regional Infrastructure Planning and Public Policy",
        "Long category name for stress testing",
      ),
      reading_time: 12,
    },
  ),
  typographyTechnical: typographyEntry(
    933,
    "Moving 400 packages to a monorepo without stopping the release train",
    [
      readerParagraphs(1),
      "<h2>The migration script</h2>",
      "<pre><code class=\"language-javascript\">import { execFileSync } from 'node:child_process'\n\nexport function importRepository({ name, remote, target }) {\n  const git = (...args) => execFileSync('git', args, { stdio: 'inherit' })\n  git('remote', 'add', name, remote)\n}\n</code></pre>",
      "<p>The path <code>/home/runner/work/monorepo/monorepo/packages/ui-button/node_modules/.cache/babel-loader/a1b2c3d4e5f6</code> appeared in more error messages than we care to admit, and <code>process.cwd()</code> was misused.</p>",
      `<h3>Build times</h3><table><thead><tr><th>Metric</th><th>Before</th><th>After</th><th>Change</th></tr></thead><tbody><tr><td>Cold build</td><td>38 min</td><td>9 min</td><td>−76%</td></tr><tr><td>See <a href="https://example.invalid/t">the report</a></td><td>12 min</td><td>2 min</td><td>−83%</td></tr></tbody></table>`,
      `<ul><li>Link in list: <a href="https://example.invalid/e">handbook</a></li><li>Plain item</li></ul>`,
      "<blockquote><h3>A heading inside a quote</h3><p>Quoted text.</p></blockquote>",
      "<ul><li><h4>A heading inside a list item</h4></li></ul>",
      `<p><a href="https://example.invalid/gallery"><img src="${readerAsset("valid-horizontal.svg")}" width="1000" height="1000" alt="" /><img src="${readerAsset("valid-vertical.svg")}" width="1000" height="1000" alt="" /></a></p>`,
      `<p>A footnote-style reference<sup><a href="https://example.invalid/note">1</a></sup> in a sentence.</p>`,
      readerParagraphs(1, 1),
    ].join(""),
    {
      author: "Priya Raman",
      feed: typographyFeed(23, "Engineering at Meridian", "Programming"),
      reading_time: 9,
    },
  ),
}
