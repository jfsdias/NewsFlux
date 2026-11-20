#!/usr/bin/env python3
"""WallHop real-contract audit: operator-run, read-only, bounded, auditable. NOT run by CI or agents.

Purpose: replace assumptions about https://wallhop.io with evidence, before WallHop is enabled:
public homepage/terms reachability, the real behaviour of ``/raw/<url>`` for ONE approved public
article (status, content type, size, rate-limit headers, structure), and nothing else.

Hard limits (enforced, not configurable):
  * explicit authorization token required: WALLHOP_AUDIT_AUTHORIZATION=OPERATOR_APPROVED_<YYYYMMDD>
    matching today's UTC date, so an old shell history line cannot re-run it;
  * at most 3 GET requests in total (homepage, robots.txt, one /raw/<article>), sequential,
    no retries, no redirects followed, 15 s timeout each, 2 MiB cap each;
  * the article must be HTTPS, publicly readable, on a domain listed in the operator-approved
    sources file (--approved-sources, JSON list of domains) and NOT in the paywall denylist;
  * no cookies, no credentials, no Miniflux data; a fixed, honest User-Agent;
  * output: classifications, sizes, hashes and header NAMES only; bodies are written to a
    0700 directory for the operator's manual review of terms and content, never printed.

Usage on the OMV (after authorization; uses the host's normal egress). The approved-sources file is
the same ``wallhop-approved-sources-v1`` document the activation SOURCE_POLICY gate reads:

    WALLHOP_AUDIT_AUTHORIZATION=OPERATOR_APPROVED_$(date -u +%Y%m%d) \\
      python3 deploy/wallhop-isolated/wallhop_contract_audit.py \\
        --approved-sources /root/newsflux/wallhop-approved-sources.json \\
        --article-url https://<approved public site>/<public article> \\
        --out-dir /root/newsflux/wallhop-audit-$(date -u +%Y%m%dT%H%M%SZ)

Standard library only.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import ssl
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable
from urllib.parse import urlsplit

WALLHOP_ORIGIN = "https://wallhop.io"
MAX_REQUESTS = 3
MAX_BODY_BYTES = 2 * 1024 * 1024
TIMEOUT_SECONDS = 15
USER_AGENT = "NewsFlux-WallHop-ContractAudit/1 (operator-run, read-only, 3 requests max)"
# Never audited through WallHop: subscription/paywalled publishers (non-exhaustive, deny-first).
PAYWALL_DENYLIST = frozenset(
    {
        "nytimes.com",
        "bloomberg.com",
        "wsj.com",
        "folha.uol.com.br",
        "economist.com",
        "ft.com",
        "washingtonpost.com",
        "estadao.com.br",
        "oglobo.globo.com",
        "valor.globo.com",
        "theatlantic.com",
        "newyorker.com",
    }
)
RATE_HEADER_PREFIXES = ("x-ratelimit", "ratelimit", "retry-after", "x-rate-limit")

Fetcher = Callable[[str], "tuple[int, dict[str, str], bytes]"]


class AuditRefused(Exception):
    """A detail-free refusal code, safe to print."""


def _domain_matches(host: str, domain: str) -> bool:
    return host == domain or host.endswith("." + domain)


def check_authorization(token: str | None, now: datetime) -> None:
    if token != f"OPERATOR_APPROVED_{now.strftime('%Y%m%d')}":
        raise AuditRefused("AUTHORIZATION_MISSING_OR_NOT_TODAY")


def check_article(url: str, approved: list[str]) -> str:
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    if parts.scheme != "https" or not host or parts.username or parts.password or parts.port not in (None, 443):
        raise AuditRefused("ARTICLE_URL_MUST_BE_PLAIN_HTTPS")
    if any(_domain_matches(host, domain) for domain in PAYWALL_DENYLIST):
        raise AuditRefused("ARTICLE_DOMAIN_IS_PAYWALLED")
    if not any(_domain_matches(host, domain.lower()) for domain in approved):
        raise AuditRefused("ARTICLE_DOMAIN_NOT_OPERATOR_APPROVED")
    return host


def load_approved(path: str) -> list[str]:
    """The wallhop-approved-sources-v1 document (docs/ops/WALLHOP_SOURCE_POLICY.md); the future policy change must read the same file."""
    try:
        document = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raise AuditRefused("APPROVED_SOURCES_UNREADABLE") from None
    try:
        assert document["version"] == "wallhop-approved-sources-v1" and document["approved_by"] and document["approved_at"]
        domains = []
        for source in document["sources"]:
            domain = source["domain"].strip().lower()
            assert domain and "/" not in domain and ":" not in domain
            assert source["public_without_login"] is True and source["terms_permit_automated_retrieval"] is True
            assert source["terms_reviewed_url"].startswith("https://")
            domains.append(domain)
        assert domains
    except (AssertionError, KeyError, TypeError, AttributeError):
        raise AuditRefused("APPROVED_SOURCES_MALFORMED") from None
    return domains


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def http_fetcher() -> Fetcher:
    opener = urllib.request.build_opener(
        urllib.request.HTTPSHandler(context=ssl.create_default_context()), _NoRedirect()
    )

    def fetch(url: str):
        request = urllib.request.Request(url, method="GET", headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
        try:
            with opener.open(request, timeout=TIMEOUT_SECONDS) as response:
                return response.status, dict(response.headers.items()), response.read(MAX_BODY_BYTES + 1)
        except urllib.error.HTTPError as error:
            return error.code, dict(error.headers.items()), error.read(MAX_BODY_BYTES + 1)
        except (urllib.error.URLError, OSError, ssl.SSLError):
            return 0, {}, b""

    return fetch


def classify(status: int, headers: dict[str, str], body: bytes) -> dict[str, object]:
    lowered = {k.lower(): v for k, v in headers.items()}
    content_type = lowered.get("content-type", "").split(";", 1)[0].strip().lower()
    shape = None
    if content_type == "application/json":
        try:
            parsed = json.loads(body[:MAX_BODY_BYTES])
            shape = sorted(parsed)[:20] if isinstance(parsed, dict) else type(parsed).__name__
        except ValueError:
            shape = "INVALID_JSON"
    return {
        "status": status,
        "content_type": content_type or None,
        "bytes": min(len(body), MAX_BODY_BYTES),
        "truncated": len(body) > MAX_BODY_BYTES,
        "sha256": hashlib.sha256(body[:MAX_BODY_BYTES]).hexdigest(),
        "redirect_location_present": "location" in lowered,
        "rate_limit_headers": sorted(k for k in lowered if k.startswith(RATE_HEADER_PREFIXES)),
        "auth_challenge": "www-authenticate" in lowered,
        "json_top_level": shape,
    }


def run(article_url: str, approved: list[str], out_dir: Path, fetch: Fetcher, now: datetime) -> dict[str, object]:
    check_article(article_url, approved)
    requests = [
        ("homepage", WALLHOP_ORIGIN + "/"),
        ("robots", WALLHOP_ORIGIN + "/robots.txt"),
        ("raw_article", WALLHOP_ORIGIN + "/raw/" + article_url),
    ]
    assert len(requests) <= MAX_REQUESTS
    out_dir.mkdir(mode=0o700, parents=True, exist_ok=False)
    report: dict[str, object] = {"audited_at": now.isoformat().replace("+00:00", "Z"), "requests": {}}
    for name, url in requests:
        status, headers, body = fetch(url)
        (out_dir / f"{name}.body").write_bytes(body[:MAX_BODY_BYTES])
        os.chmod(out_dir / f"{name}.body", 0o600)
        report["requests"][name] = classify(status, headers, body)
    report["article_domain"] = urlsplit(article_url).hostname
    report["contract_status"] = (
        "OBSERVED_NEEDS_OPERATOR_REVIEW"
        if report["requests"]["raw_article"]["status"] == 200
        else "RAW_ENDPOINT_NOT_OK"
    )
    (out_dir / "report.json").write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.chmod(out_dir / "report.json", 0o600)
    # Draft for the WALLHOP_REAL_CONTRACT gate (W1, docs/ops/WALLHOP_READINESS.md). Observed facts only: the
    # operator must review the saved terms/content and set terms_reviewed + checked_by by hand;
    # the draft can never pass the gate on its own.
    raw = report["requests"]["raw_article"]
    draft = {
        "version": "wallhop-contract-evidence-v1",
        "checked_by": None,
        "checked_at": report["audited_at"],
        "endpoint": "https://wallhop.io/raw/",
        "http_status": raw["status"],
        "content_type": raw["content_type"] or "",
        "sample_domain": report["article_domain"],
        "terms_reviewed": False,
        "no_credentials_or_cookies_used": True,
        "audit_report_sha256": hashlib.sha256((out_dir / "report.json").read_bytes()).hexdigest(),
    }
    (out_dir / "contract-evidence.draft.json").write_text(json.dumps(draft, indent=2) + "\n", encoding="utf-8")
    os.chmod(out_dir / "contract-evidence.draft.json", 0o600)
    return report


def main(argv: list[str] | None = None, *, fetch: Fetcher | None = None, now: datetime | None = None, environ=None) -> int:
    parser = argparse.ArgumentParser(description="Operator-run, read-only WallHop contract audit (3 GETs max).")
    parser.add_argument("--approved-sources", required=True)
    parser.add_argument("--article-url", required=True)
    parser.add_argument("--out-dir", required=True)
    args = parser.parse_args(argv)
    now = now or datetime.now(timezone.utc)
    environ = os.environ if environ is None else environ
    try:
        check_authorization(environ.get("WALLHOP_AUDIT_AUTHORIZATION"), now)
        approved = load_approved(args.approved_sources)
        report = run(args.article_url, approved, Path(args.out_dir), fetch or http_fetcher(), now)
    except AuditRefused as refusal:
        print(f"WALLHOP_CONTRACT_AUDIT=REFUSED CODE={refusal}")
        return 1
    except FileExistsError:
        print("WALLHOP_CONTRACT_AUDIT=REFUSED CODE=OUT_DIR_EXISTS")
        return 1
    for name, item in report["requests"].items():
        print(f"{name.upper()}_STATUS={item['status']} CONTENT_TYPE={item['content_type']} BYTES={item['bytes']} RATE_HEADERS={','.join(item['rate_limit_headers']) or 'NONE'}")
    print(f"WALLHOP_CONTRACT_AUDIT={report['contract_status']}")
    print("NEXT=review report.json and the saved bodies (terms, redistribution, storage); record the decision in the ledger")
    return 0


if __name__ == "__main__":
    sys.exit(main())
