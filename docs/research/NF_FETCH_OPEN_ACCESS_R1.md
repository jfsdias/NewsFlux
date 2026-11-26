# NF-FETCH-OPEN-ACCESS-R1 — bibliographic identity admission

The original proposal explored metadata-only licensed open-access records on authored fixtures. No verified provider is wired into NewsFlux. Do not infer access rights from a DOI, a teaser, or a third-party record; do not retrieve a copy or replace the publisher's access flow.

**PM disposition:** ship only explicit academic DOI identity in the Reader. Recognize the original canonical HTTPS DOI URL already supplied by Miniflux, display its identifier as bibliographic metadata, and preserve the existing source link and content. Ordinary articles are unchanged. No external lookup, alternate-location links, provider transfer, credentials, persistence, acquisition or access-control changes. Licensed location discovery remains a separate HOLD pending an explicit approved provider/privacy design and independently verified provenance.

Qualification: unit tests for exact canonical identity and rejection of ambiguous inputs; canonical NF-DOI-1 browser test for the original article/source link, no automatic DOI requests, no DOI on unrelated articles and no mutations. No claim of access status.
