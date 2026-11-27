#!/usr/bin/env python3
"""Operator-only, read-only LiteLLM audit of the S5 virtual key. Produces the S5 key attestation.

Run on the host by the operator, never inside the Summary or Reader containers, with a read-only
LiteLLM admin credential (preferred: a key whose user role is proxy_admin_viewer; the master key only
interactively and never stored next to the application):

    sudo python3 ops/deploy/release-governance/s5_key_audit.py \
        --gateway-url https://litellm.example \
        --admin-key-file /root/secrets/litellm-admin-viewer.key \
        --virtual-key-file /srv/newsflux/secrets/litellm-virtual-key \
        --alias newsflux-s5-free \
        --out "$(sudo -E bash ops/deploy/release-governance/ai-functional-release.sh s5-attestation-path)" \
        [--confirm-provider-cost-zero --reference "provider free-tier terms, reviewed 2026-11-15"]

Requests (both read-only):
  POST /v2/key/info  {"keys": [<LiteLLM token hash>]}   the hash travels in the TLS body, never in a URL
  GET  /model/info                                      deployments of the alias and their unit costs

Nothing is changed in LiteLLM. Output on the terminal: classifications only. The attestation file
(0600) holds the key's policy fields, the alias' published unit costs, the operator's confirmation and
a domain-separated fingerprint that binds it to the virtual key. It never holds the virtual key, the
admin credential, LiteLLM's token hash, the gateway URL or any LiteLLM parameters.

Python standard library only, so it runs on the host without the application's dependencies.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import ssl
import stat
import sys
import urllib.error
import urllib.request
from collections.abc import Callable
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlsplit

ATTESTATION_SCHEMA = "newsflux-s5-key-attestation-v1"
EVIDENCE_KIND = "LIVE_LITELLM_ADMIN_READ"
FINGERPRINT_DOMAIN = b"newsflux-s5-key-attestation-v1\x00"
MAX_RESPONSE_BYTES = 512 * 1024
KEY_FIELDS = (
    "status",
    "blocked",
    "expires",
    "models",
    "max_budget",
    "budget_duration",
    "spend",
    "tpm_limit",
    "rpm_limit",
    "allowed_routes",
)

Request = Callable[[str, str, "dict[str, Any] | None"], Any]


class AuditError(Exception):
    """Carries a detail-free code that is safe to print."""


def token_hash(virtual_key: str) -> str:
    return hashlib.sha256(virtual_key.encode("utf-8")).hexdigest()


def key_fingerprint(virtual_key: str) -> str:
    # Must stay identical to services.article_intel_summary.s5_preflight.key_fingerprint.
    return hashlib.sha256(FINGERPRINT_DOMAIN + token_hash(virtual_key).encode("ascii")).hexdigest()


def read_private_file(path: str, code: str) -> str:
    try:
        info = os.lstat(path)
    except OSError:
        raise AuditError(f"{code}_UNREADABLE") from None
    if not stat.S_ISREG(info.st_mode):
        raise AuditError(f"{code}_NOT_REGULAR_FILE")
    if info.st_mode & 0o077:
        raise AuditError(f"{code}_PERMISSIONS_TOO_OPEN")
    try:
        with open(path, encoding="utf-8") as handle:
            value = handle.read(4096).strip()
    except (OSError, UnicodeDecodeError):
        raise AuditError(f"{code}_UNREADABLE") from None
    if not value or any(ch.isspace() for ch in value):
        raise AuditError(f"{code}_EMPTY_OR_MALFORMED")
    return value


def build_attestation(
    request: Request,
    *,
    virtual_key: str,
    alias: str,
    now: datetime,
    provider_cost_zero_confirmed: bool,
    reference: str,
) -> tuple[dict[str, Any], dict[str, str]]:
    if not virtual_key.startswith("sk-"):
        raise AuditError("VIRTUAL_KEY_FORMAT_UNSUPPORTED")
    summary: dict[str, str] = {}
    payload = request("POST", "/v2/key/info", {"keys": [token_hash(virtual_key)]})
    rows = payload.get("info") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        raise AuditError("KEY_INFO_MALFORMED")
    if len(rows) != 1 or not isinstance(rows[0], dict):
        raise AuditError("KEY_NOT_FOUND" if not rows else "KEY_INFO_AMBIGUOUS")
    row = rows[0]
    key = {name: row[name] for name in KEY_FIELDS if name in row}
    summary["KEY_FOUND"] = "YES"

    payload = request("GET", "/model/info", None)
    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, list):
        raise AuditError("MODEL_INFO_MALFORMED")
    pricing = []
    for item in data:
        if isinstance(item, dict) and item.get("model_name") == alias:
            info = item.get("model_info") if isinstance(item.get("model_info"), dict) else {}
            pricing.append(
                {
                    "input_cost_per_token": info.get("input_cost_per_token"),
                    "output_cost_per_token": info.get("output_cost_per_token"),
                }
            )
    summary["ALIAS_DEPLOYMENTS"] = str(len(pricing))

    operator: dict[str, Any] = {"provider_cost_zero_confirmed": False}
    if provider_cost_zero_confirmed:
        if not reference.strip():
            raise AuditError("PROVIDER_CONFIRMATION_NEEDS_REFERENCE")
        operator = {
            "provider_cost_zero_confirmed": True,
            "reference": reference.strip()[:500],
            "confirmed_at": now.isoformat().replace("+00:00", "Z"),
        }
    summary["PROVIDER_COST_CONFIRMATION"] = "OPERATOR_CONFIRMED" if provider_cost_zero_confirmed else "MISSING"
    document = {
        "schema": ATTESTATION_SCHEMA,
        "evidence_kind": EVIDENCE_KIND,
        "captured_at": now.isoformat().replace("+00:00", "Z"),
        "key_fingerprint": key_fingerprint(virtual_key),
        "alias": alias,
        "key": key,
        "pricing": pricing,
        "operator": operator,
    }
    summary["KEY_FINGERPRINT_PREFIX"] = document["key_fingerprint"][:12]
    return document, summary


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args: Any, **kwargs: Any) -> None:
        return None


def http_requester(gateway_url: str, admin_key: str, ca_file: str | None) -> Request:
    parts = urlsplit(gateway_url)
    if parts.scheme != "https" or not parts.hostname or parts.path not in ("", "/") or parts.query or parts.username:
        raise AuditError("GATEWAY_URL_MUST_BE_PLAIN_HTTPS_ORIGIN")
    base = f"https://{parts.netloc}"
    context = ssl.create_default_context(cafile=ca_file) if ca_file else ssl.create_default_context()
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({}), urllib.request.HTTPSHandler(context=context), _NoRedirect()
    )

    def request(method: str, path: str, body: dict[str, Any] | None) -> Any:
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(base + path, data=data, method=method)
        req.add_header("Authorization", f"Bearer {admin_key}")
        req.add_header("Accept", "application/json")
        if data is not None:
            req.add_header("Content-Type", "application/json")
        try:
            with opener.open(req, timeout=15) as response:
                if response.status != 200:
                    raise AuditError(f"{path.strip('/').replace('/', '_').upper()}_HTTP_{response.status}")
                raw = response.read(MAX_RESPONSE_BYTES + 1)
        except urllib.error.HTTPError as error:
            raise AuditError(f"{path.strip('/').replace('/', '_').upper()}_HTTP_{error.code}") from None
        except (urllib.error.URLError, OSError, ssl.SSLError):
            raise AuditError("GATEWAY_UNREACHABLE_OR_TLS_FAILED") from None
        if len(raw) > MAX_RESPONSE_BYTES:
            raise AuditError("RESPONSE_TOO_LARGE")
        try:
            return json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            raise AuditError("RESPONSE_NOT_JSON") from None

    return request


def write_private(path: str, document: dict[str, Any]) -> None:
    directory = os.path.dirname(os.path.abspath(path))
    temporary = os.path.join(directory, f".{os.path.basename(path)}.{os.getpid()}.tmp")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(document, handle, indent=2, sort_keys=True)
            handle.write("\n")
        os.replace(temporary, path)
    except BaseException:
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise


def main(argv: list[str] | None = None, *, request: Request | None = None, now: datetime | None = None) -> int:
    parser = argparse.ArgumentParser(description="Read-only LiteLLM audit of the S5 virtual key (operator only).")
    parser.add_argument("--gateway-url", required=True)
    parser.add_argument("--admin-key-file", required=True)
    parser.add_argument("--virtual-key-file", required=True)
    parser.add_argument("--alias", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--ca-file")
    parser.add_argument("--confirm-provider-cost-zero", action="store_true")
    parser.add_argument("--reference", default="")
    args = parser.parse_args(argv)
    try:
        virtual_key = read_private_file(args.virtual_key_file, "VIRTUAL_KEY_FILE")
        if request is None:
            admin_key = read_private_file(args.admin_key_file, "ADMIN_KEY_FILE")
            request = http_requester(args.gateway_url, admin_key, args.ca_file)
        document, summary = build_attestation(
            request,
            virtual_key=virtual_key,
            alias=args.alias,
            now=now or datetime.now(timezone.utc),
            provider_cost_zero_confirmed=args.confirm_provider_cost_zero,
            reference=args.reference,
        )
        write_private(args.out, document)
    except AuditError as error:
        print(f"S5_KEY_AUDIT=FAILED CODE={error}")
        return 1
    for name, value in summary.items():
        print(f"{name}={value}")
    print("S5_KEY_AUDIT=WRITTEN")
    print("NEXT=sudo -E bash ai-functional-release.sh s5-preflight  (evaluates the attestation; this tool decides nothing)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
