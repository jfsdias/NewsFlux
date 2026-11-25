# NF-FETCH-OPEN-ACCESS-R1

Goal: improve Fetch Content by offering a publisher-authorized open-access location for an academic article with a known DOI. Unpaywall v2 documents DOI lookup and metadata for OA locations: https://unpaywall.org/api and https://unpaywall.org/data-format. Not a general newspaper paywall removal mechanism. No WallHop provider or access-control circumvention.

R1 is a metadata-only local contract, using authored synthetic inputs. Exact DOI match, explicit OA flag, known license, explicit version, publisher/repository host type and HTTPS landing page required; do not infer open rights from a teaser or missing license. Result is a suggested link with provenance/version, not fetched article content or automatic navigation. No provider request, credentials, API email, external transfer, new fetcher, persistence or runtime integration.

Next isolated vertical slice: mock UI action with original article retained, explicit user selection, no automatic subscription or read-state mutation. Before real lookup, verify provider terms/privacy and user opt-in for DOI transfer; before any article retrieval, validate the editor-authorized location and preserve existing network/security boundaries. If no eligible link exists, offer original publisher and existing access flow. Readability #313 separately evaluates presentation of already accessible visible HTML; no linkage to bypassing restricted material.

Tests: 4/4 local Node synthetic assertions, no network. Full repo build/UI qualification pending. No merge/deploy authorized by the document.
