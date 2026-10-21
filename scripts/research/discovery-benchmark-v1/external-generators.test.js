import assert from "node:assert/strict"
import test from "node:test"

import {
  EXTERNAL_GENERATOR_FIXTURES,
  normalizeExternalGeneratorCandidates,
  preparePublicQuerySet,
} from "./external-generators.js"

test("does not prepare external requests without a user-approved public query set", () => {
  assert.deepEqual(preparePublicQuerySet([]), {
    ready: false,
    reason: "USER_APPROVAL_REQUIRED",
    requests: [],
  })
  assert.equal(
    preparePublicQuerySet(
      [
        {
          query: "https://private.local/story",
          sourceOfTopic: "profile",
          whySafeToExport: "public",
        },
      ],
      {
        approvedByUser: true,
      },
    ).reason,
    "QUERY_SET_REQUIRES_PUBLIC_TOPIC_PROVENANCE",
  )
})

test("prepares a public query envelope without executing or transmitting it", () => {
  const prepared = preparePublicQuerySet(
    [
      {
        id: "PUBLIC_QUERY_01",
        query: "publicly documented climate journalism",
        sourceOfTopic: "user supplied public topic",
        whySafeToExport: "No account history, source names, or article titles are included.",
      },
    ],
    { approvedByUser: true },
  )

  assert.equal(prepared.ready, true)
  assert.equal(prepared.executed, false)
  assert.deepEqual(
    prepared.requests.map(({ generator }) => generator),
    ["G3_GDELT", "G4_GENERAL_SEARCH", "G5_OPEN_FEED_INDEX"],
  )
})

test("normalizes external-generator fixtures without fetching candidates", () => {
  for (const [generator, fixture] of Object.entries(EXTERNAL_GENERATOR_FIXTURES)) {
    const result = normalizeExternalGeneratorCandidates(generator, fixture)
    assert.equal(result.remoteFetchPerformed, false)
    assert.equal(result.candidates.length, 1)
    assert.equal(result.candidates[0].discoveryOrigins[0], generator)
    assert.equal(result.candidates[0].valueLabel, "UNKNOWN")
  }

  const safe = normalizeExternalGeneratorCandidates("G4_GENERAL_SEARCH", [
    { siteUrl: "https://publisher.example.com?utm_source=x", feedUrl: "http://127.0.0.1/rss.xml" },
    {
      siteUrl: "https://redirect.example.net/out?url=https%3A%2F%2Felsewhere.example",
      feedUrl: null,
    },
    {
      siteUrl: "https://publisher.example.com/story",
      feedUrl: "https://publisher.example.com/rss.xml",
    },
  ])
  assert.equal(safe.candidates.length, 1)
  assert.deepEqual(safe.candidates[0].candidateFeedUrls, ["https://publisher.example.com/rss.xml"])
})
