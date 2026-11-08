from __future__ import annotations

import hashlib
import json
import logging
import re
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass
from datetime import datetime, timezone
from urllib.parse import parse_qsl, urlsplit, urlunsplit

from services.content_fallback.content import (
    ContentAssessment,
    assess_content,
    clean_wallhop_content,
    passes_recovery,
)
from services.content_fallback.http_client import (
    DEFAULT_TIMEOUT_SECONDS,
    FetchError,
    PinnedHTTPClient,
    Resolver,
    UnsafeURL,
    resolve_host,
)
from services.content_fallback.miniflux import EntrySnapshot, MinifluxClient, MinifluxError
from services.content_fallback.policy import PolicyRegistry
from services.content_fallback.store import MemoryRecoveryStore, RecoveryStore, StoredRecovery

LOGGER = logging.getLogger("newsflux.content_fallback")
MAX_WALLHOP_BYTES = 4 * 1024 * 1024
MAX_WALLHOP_ATTEMPTS = 2
MAX_CONCURRENT_RECOVERIES = 4
CACHE_TTL_SECONDS = 15 * 60
CACHE_MAX_ENTRIES = 256
_SENSITIVE_QUERY_RE = re.compile(
    r"(?:token|auth|secret|password|session|signature|api[_-]?key|(?:^|[_-])key(?:$|[_-])|^sig$|^jwt$|^code$)",
    re.I,
)


class RecoveryError(RuntimeError):
    pass


def _assess_wallhop_content(title: str, content_html: str) -> ContentAssessment:
    raw_assessment = assess_content(title, content_html)
    if raw_assessment.blocked_page:
        raise RecoveryError("block_page_marker")
    if raw_assessment.paywall_signal:
        raise RecoveryError("paywall_marker")

    cleaned_html, cleanup_reason = clean_wallhop_content(raw_assessment.safe_html)
    if cleanup_reason == "ambiguous_provider_chrome":
        raise RecoveryError("ambiguous_provider_chrome")
    # Re-assess the exact sanitized content that may be returned or persisted.
    return assess_content(title, cleaned_html)


@dataclass(frozen=True)
class ProviderResult:
    assessment: ContentAssessment
    fetched_at: str
    provider: str = "wallhop.io"


class WallHopProvider:
    def __init__(
        self,
        *,
        http: PinnedHTTPClient | None = None,
        timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
        sleep=time.sleep,
    ) -> None:
        self.http = http or PinnedHTTPClient()
        self.timeout_seconds = timeout_seconds
        self._sleep = sleep

    @staticmethod
    def _source_url(url: str) -> str:
        try:
            parts = urlsplit(url)
        except ValueError as exc:
            raise UnsafeURL("source URL is malformed") from exc
        if parts.scheme.casefold() not in {"http", "https"} or not parts.hostname:
            raise UnsafeURL("source URL is not HTTP or HTTPS")
        if parts.username is not None or parts.password is not None:
            raise UnsafeURL("source URL contains credentials")
        try:
            port = parts.port
        except ValueError as exc:
            raise UnsafeURL("source URL has an invalid port") from exc
        default_port = 443 if parts.scheme.casefold() == "https" else 80
        if port not in {None, default_port}:
            raise UnsafeURL("source URL uses a non-standard port")
        if any(_SENSITIVE_QUERY_RE.search(key) for key, _ in parse_qsl(parts.query, keep_blank_values=True)):
            raise UnsafeURL("source URL contains a sensitive query parameter")
        return urlunsplit(parts._replace(fragment=""))

    @staticmethod
    def _wallhop_url(source_url: str) -> str:
        return "https://wallhop.io/raw/" + source_url

    def recover(self, entry: EntrySnapshot, original: ContentAssessment) -> ProviderResult:
        source_url = self._source_url(entry.url)
        parts = urlsplit(source_url)
        port = parts.port or (443 if parts.scheme.casefold() == "https" else 80)
        # Reject private, loopback, link-local and metadata destinations before a third
        # party receives the URL. The provider fetch itself is also pinned and checked.
        try:
            self.http._resolver(parts.hostname or "", port, False)
        except UnsafeURL:
            raise
        except FetchError as exc:
            raise RecoveryError("source_host_unavailable") from exc
        wallhop_url = self._wallhop_url(source_url)
        last_error: Exception | None = None
        for attempt in range(MAX_WALLHOP_ATTEMPTS):
            try:
                response = self.http.get(
                    wallhop_url,
                    timeout=self.timeout_seconds,
                    max_bytes=MAX_WALLHOP_BYTES,
                    max_redirects=3,
                )
                if response.status in {429, 500, 502, 503, 504} and attempt + 1 < MAX_WALLHOP_ATTEMPTS:
                    self._sleep(0.1)
                    continue
                if response.status != 200:
                    raise RecoveryError(f"WallHop returned HTTP {response.status}")
                media_type = response.headers.get("content-type", "").split(";", 1)[0].strip().casefold()
                if media_type and media_type not in {"text/html", "text/plain", "application/xhtml+xml"}:
                    raise RecoveryError("WallHop returned an unsupported content type")
                charset = "utf-8"
                for part in response.headers.get("content-type", "").split(";")[1:]:
                    name, separator, value = part.strip().partition("=")
                    if separator and name.casefold() == "charset":
                        candidate_charset = value.strip(" \"'")
                        if re.fullmatch(r"[A-Za-z0-9._-]{1,40}", candidate_charset):
                            charset = candidate_charset
                        break
                try:
                    html_body = response.body.decode(charset, errors="replace")
                except LookupError:
                    html_body = response.body.decode("utf-8", errors="replace")
                assessment = _assess_wallhop_content(entry.title, html_body)
                if not passes_recovery(original, assessment):
                    raise RecoveryError(assessment.reason)
                return ProviderResult(
                    assessment=assessment,
                    fetched_at=datetime.now(timezone.utc).isoformat(),
                )
            except (FetchError, RecoveryError, OSError, TimeoutError, UnicodeError) as exc:
                last_error = exc
                if isinstance(exc, UnsafeURL):
                    raise
                if attempt + 1 < MAX_WALLHOP_ATTEMPTS and not isinstance(exc, UnsafeURL):
                    self._sleep(0.1)
        if last_error is None:
            raise RecoveryError("WallHop did not return a usable response")
        if isinstance(last_error, UnsafeURL):
            raise last_error
        if isinstance(last_error, RecoveryError):
            raise RecoveryError(str(last_error)) from last_error
        # Do not propagate upstream error details, response text, or URLs to the caller.
        raise RecoveryError("WallHop did not return validated full text") from last_error


class MinifluxScraperProvider:
    """Response-only use of Miniflux's native scraper for explicit public-feed rules."""

    def __init__(self, miniflux: MinifluxClient, *, resolver: Resolver = resolve_host) -> None:
        self.miniflux = miniflux
        self.resolver = resolver

    def recover(self, entry: EntrySnapshot, original: ContentAssessment) -> ProviderResult:
        source_url = WallHopProvider._source_url(entry.url)
        parts = urlsplit(source_url)
        port = parts.port or (443 if parts.scheme.casefold() == "https" else 80)
        try:
            self.resolver(parts.hostname or "", port, False)
        except UnsafeURL:
            raise
        except FetchError as exc:
            raise RecoveryError("miniflux_source_host_unavailable") from exc
        try:
            urlrewrite_rules = self.miniflux.get_feed_urlrewrite_rules(entry.feed_id)
            if urlrewrite_rules.strip():
                raise RecoveryError("miniflux_url_rewrite_rules_present")
            content = self.miniflux.fetch_entry_content(entry.id)
            if self.miniflux.get_feed_urlrewrite_rules(entry.feed_id) != urlrewrite_rules:
                raise RecoveryError("miniflux_url_rewrite_rules_changed")
        except MinifluxError as exc:
            raise RecoveryError("miniflux_scraper_unavailable") from exc
        assessment = assess_content(entry.title, content)
        if not passes_recovery(original, assessment):
            raise RecoveryError(assessment.reason)
        return ProviderResult(
            assessment=assessment,
            fetched_at=datetime.now(timezone.utc).isoformat(),
            provider="miniflux",
        )


@dataclass
class _Flight:
    event: threading.Event
    result: dict[str, object] | None = None


class _RecoveryCache:
    def __init__(self, *, ttl_seconds: int = CACHE_TTL_SECONDS, max_entries: int = CACHE_MAX_ENTRIES) -> None:
        self.ttl_seconds = ttl_seconds
        self.max_entries = max_entries
        self.lock = threading.Lock()
        self.values: OrderedDict[str, tuple[float, dict[str, object]]] = OrderedDict()

    def get(self, key: str) -> dict[str, object] | None:
        now = time.monotonic()
        with self.lock:
            item = self.values.get(key)
            if item is None:
                return None
            expires_at, value = item
            if expires_at <= now:
                del self.values[key]
                return None
            self.values.move_to_end(key)
            return dict(value)

    def put(self, key: str, value: dict[str, object]) -> None:
        with self.lock:
            self.values[key] = (time.monotonic() + self.ttl_seconds, dict(value))
            self.values.move_to_end(key)
            while len(self.values) > self.max_entries:
                self.values.popitem(last=False)


class ContentFallbackService:
    """Read-only recovery flow with a strict allowlist and bounded persistence."""

    def __init__(
        self,
        *,
        miniflux: MinifluxClient,
        policies: PolicyRegistry,
        provider: WallHopProvider | None = None,
        miniflux_provider: MinifluxScraperProvider | None = None,
        max_concurrent: int = MAX_CONCURRENT_RECOVERIES,
        max_concurrent_per_domain: int = 2,
        cache: _RecoveryCache | None = None,
        store: RecoveryStore | None = None,
        follower_wait_seconds: float = 18,
    ) -> None:
        self.miniflux = miniflux
        self.policies = policies
        self.provider = provider or WallHopProvider()
        self.miniflux_provider = miniflux_provider or MinifluxScraperProvider(miniflux)
        self.max_concurrent = max_concurrent
        self.max_concurrent_per_domain = max_concurrent_per_domain
        self._semaphore = threading.BoundedSemaphore(max_concurrent)
        self._cache = cache or _RecoveryCache()
        self.store = store or MemoryRecoveryStore()
        self._lock = threading.Lock()
        self._inflight: dict[str, _Flight] = {}
        self._domain_active: dict[str, int] = {}
        self._follower_wait_seconds = follower_wait_seconds

    def recover(self, entry_id: int) -> dict[str, object]:
        try:
            entry = self.miniflux.get_entry(entry_id)
        except MinifluxError as exc:
            if str(exc) == "entry not found":
                self._delete_stored(entry_id)
            raise RecoveryError(str(exc)) from exc
        original = assess_content(entry.title, entry.content)
        original_response = self._base_response(entry, original)
        if original.sufficient:
            self._delete_stored(entry.id)
            return {**original_response, "status": "original_sufficient", "reason": "content_complete"}

        decision = self.policies.decide(url=entry.url, feed_id=entry.feed_id)
        if not decision.on_demand:
            self._delete_stored(entry.id)
            return {
                **original_response,
                "status": "disabled",
                "reason": decision.reason,
            }

        key = hashlib.sha256(
            json.dumps(
                [entry.id, entry.fingerprint, decision.policy.provider],
                separators=(",", ":"),
            ).encode("utf-8")
        ).hexdigest()
        cached = self._cache.get(key)
        if cached is not None:
            return {**cached, "cache_hit": True}

        stored = self._get_stored(entry)
        expected_stored_provider = (
            "wallhop.io" if decision.policy.provider == "wallhop" else "miniflux"
        )
        if stored is not None and stored.provider != expected_stored_provider:
            self._delete_stored(entry.id)
            stored = None
        stored_assessment = None
        stored_rejection_reason = None
        if stored is not None:
            try:
                if stored.provider == "wallhop.io":
                    stored_assessment = _assess_wallhop_content(entry.title, stored.content_html)
                else:
                    stored_assessment = assess_content(entry.title, stored.content_html)
            except RecoveryError as exc:
                stored_assessment = None
                stored_rejection_reason = str(exc)
            if stored_assessment is None or not passes_recovery(original, stored_assessment):
                rejection_reason = stored_rejection_reason or (
                    stored_assessment.reason if stored_assessment is not None else "content_revalidation_failed"
                )
                LOGGER.warning(
                    "Persistent content recovery rejected after revalidation: %s",
                    rejection_reason,
                    extra={"entry_id": entry.id, "provider": stored.provider, "reason": rejection_reason},
                )
                self._delete_stored(entry.id)
                stored = None
                stored_assessment = None
        if stored is not None and stored_assessment is not None:
            result = {
                **original_response,
                "content_html": stored_assessment.safe_html,
                "content_origin": "wallhop" if stored.provider == "wallhop.io" else "miniflux_scraper",
                "status": "recovered",
                "reason": "validated_full_text",
                "validation": stored_assessment.public_dict(),
                "provenance": {"provider": stored.provider, "fetched_at": stored.fetched_at},
                "cache_hit": True,
            }
            self._cache.put(key, result)
            return result

        domain = (urlsplit(entry.url).hostname or "").casefold()
        with self._lock:
            flight = self._inflight.get(key)
            leader = flight is None
            if leader:
                if not self._semaphore.acquire(blocking=False):
                    return {**original_response, "status": "busy", "reason": "concurrency_limit"}
                if self._domain_active.get(domain, 0) >= self.max_concurrent_per_domain:
                    self._semaphore.release()
                    return {**original_response, "status": "busy", "reason": "domain_concurrency_limit"}
                self._domain_active[domain] = self._domain_active.get(domain, 0) + 1
                flight = _Flight(event=threading.Event())
                self._inflight[key] = flight

        assert flight is not None
        if not leader:
            if not flight.event.wait(self._follower_wait_seconds):
                return {**original_response, "status": "busy", "reason": "duplicate_request_in_progress"}
            if flight.result is not None:
                return {**flight.result, "cache_hit": True, "deduplicated": True}
            cached = self._cache.get(key)
            return {**(cached or original_response), "status": "provider_unavailable", "reason": "deduplicated_failure"}

        result: dict[str, object] = original_response
        try:
            selected_provider = self.provider if decision.policy.provider == "wallhop" else self.miniflux_provider
            provider_result = selected_provider.recover(entry, original)
            # A feed refresh or article identity/content change while the provider is
            # in flight makes the result stale. Read/star state is user state and does
            # not change which article the recovered text belongs to.
            try:
                current = self.miniflux.get_entry(entry.id)
            except MinifluxError:
                result = {
                    **original_response,
                    "status": "verification_unavailable",
                    "reason": "unable_to_confirm_entry_snapshot",
                }
            else:
                if current.content_fingerprint != entry.content_fingerprint:
                    current_assessment = assess_content(current.title, current.content)
                    result = {
                        **self._base_response(current, current_assessment),
                        "status": "stale",
                        "reason": "entry_changed_during_recovery",
                    }
                else:
                    result = {
                        **original_response,
                        "content_html": provider_result.assessment.safe_html,
                        "content_origin": (
                            "wallhop" if provider_result.provider == "wallhop.io" else "miniflux_scraper"
                        ),
                        "status": "recovered",
                        "reason": "validated_full_text",
                        "validation": provider_result.assessment.public_dict(),
                        "provenance": {
                            "provider": provider_result.provider,
                            "fetched_at": provider_result.fetched_at,
                        },
                    }
                    self._cache.put(key, result)
                    self._put_stored(entry, provider_result)
        except UnsafeURL:
            result = {**original_response, "status": "skipped_security", "reason": "unsafe_source_url"}
        except RecoveryError as exc:
            # Only our short reason codes reach the response; never include a URL, HTML,
            # upstream exception body, cookie, token, or credential in logs.
            incomplete_reasons = {
                "block_page_marker", "paywall_marker", "short_or_partial_prose",
                "title_only", "insufficient_prose_structure", "no_text",
                "ambiguous_provider_chrome",
            }
            security_reasons = {
                "miniflux_url_rewrite_rules_present",
                "miniflux_url_rewrite_rules_changed",
            }
            reason = str(exc) if str(exc) in incomplete_reasons else "provider_unavailable"
            status = "incomplete" if reason in incomplete_reasons else "provider_unavailable"
            if str(exc) in security_reasons:
                reason = str(exc)
                status = "skipped_security"
            result = {**original_response, "status": status, "reason": reason}
        except Exception:
            LOGGER.error(
                "Unexpected content fallback failure",
                extra={"entry_id": entry.id, "host": (urlsplit(entry.url).hostname or "")[:253]},
            )
            result = {**original_response, "status": "provider_unavailable", "reason": "internal_error"}
        finally:
            with self._lock:
                flight.result = dict(result)
                flight.event.set()
                self._inflight.pop(key, None)
                active = self._domain_active.get(domain, 0) - 1
                if active > 0:
                    self._domain_active[domain] = active
                else:
                    self._domain_active.pop(domain, None)
            self._semaphore.release()
        LOGGER.info(
            "Content fallback request completed",
            extra={
                "entry_id": entry.id,
                "host": (urlsplit(entry.url).hostname or "")[:253],
                "status": result.get("status"),
            },
        )
        return result

    def _get_stored(self, entry: EntrySnapshot) -> StoredRecovery | None:
        try:
            return self.store.get(entry.id, entry.content_fingerprint)
        except Exception:
            LOGGER.warning("Content fallback persistent cache read failed", extra={"entry_id": entry.id})
            return None

    def _put_stored(self, entry: EntrySnapshot, recovery: ProviderResult) -> None:
        try:
            self.store.put(
                entry.id,
                entry.content_fingerprint,
                StoredRecovery(
                    source_fingerprint=entry.content_fingerprint,
                    content_html=recovery.assessment.safe_html,
                    validation=recovery.assessment.public_dict(),
                    provider=recovery.provider,
                    fetched_at=recovery.fetched_at,
                ),
            )
        except Exception:
            LOGGER.warning("Content fallback persistent cache write failed", extra={"entry_id": entry.id})

    def _delete_stored(self, entry_id: int) -> None:
        try:
            self.store.delete(entry_id)
        except Exception:
            LOGGER.warning("Content fallback persistent cache invalidation failed", extra={"entry_id": entry_id})

    @staticmethod
    def _base_response(entry: EntrySnapshot, assessment: ContentAssessment) -> dict[str, object]:
        return {
            "entry_id": entry.id,
            "url_fingerprint": hashlib.sha256(entry.url.encode("utf-8")).hexdigest(),
            "title": entry.title,
            "content_html": assessment.safe_html,
            "content_origin": "miniflux",
            "validation": assessment.public_dict(),
            "provenance": None,
            "cache_hit": False,
            "deduplicated": False,
        }
