from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from urllib.parse import urlsplit

from services.content_fallback.http_client import FetchError, PinnedHTTPClient

MAX_ENTRY_RESPONSE_BYTES = 2 * 1024 * 1024
MAX_IDENTITY_RESPONSE_BYTES = 64 * 1024


class MinifluxError(RuntimeError):
    pass


@dataclass(frozen=True)
class EntrySnapshot:
    id: int
    feed_id: int
    title: str
    url: str
    published_at: str
    status: str
    starred: bool
    content: str

    @property
    def content_fingerprint(self) -> str:
        """Stable identity for a recovery across read/star state changes."""

        serialized = json.dumps(
            {
                "id": self.id,
                "feed_id": self.feed_id,
                "title": self.title,
                "url": self.url,
                "published_at": self.published_at,
                "content_sha256": hashlib.sha256(self.content.encode("utf-8")).hexdigest(),
            },
            sort_keys=True,
            separators=(",", ":"),
        )
        return hashlib.sha256(serialized.encode("utf-8")).hexdigest()

    @property
    def fingerprint(self) -> str:
        serialized = json.dumps(
            {
                "id": self.id,
                "feed_id": self.feed_id,
                "title": self.title,
                "url": self.url,
                "published_at": self.published_at,
                "status": self.status,
                "starred": self.starred,
                "content_sha256": hashlib.sha256(self.content.encode("utf-8")).hexdigest(),
            },
            sort_keys=True,
            separators=(",", ":"),
        )
        return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class MinifluxIdentity:
    id: int
    username: str
    is_admin: bool


class MinifluxClient:
    """Narrow Miniflux 2.3.5 API client. This class exposes GET only."""

    def __init__(
        self,
        base_url: str,
        api_token: str,
        *,
        http: PinnedHTTPClient | None = None,
        timeout_seconds: float = 8,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_token = api_token
        self.http = http or PinnedHTTPClient()
        self.timeout_seconds = timeout_seconds
        parts = urlsplit(self.base_url)
        if parts.scheme not in {"http", "https"} or not parts.hostname:
            raise ValueError("MINIFLUX_BASE_URL must be an absolute HTTP or HTTPS URL")
        if parts.username is not None or parts.password is not None or parts.query or parts.fragment:
            raise ValueError("MINIFLUX_BASE_URL must not contain credentials or query parameters")
        if any(char in api_token for char in "\r\n\x00"):
            raise ValueError("Miniflux API token contains invalid characters")

    def get_entry(self, entry_id: int) -> EntrySnapshot:
        if isinstance(entry_id, bool) or not isinstance(entry_id, int) or entry_id <= 0:
            raise MinifluxError("invalid entry ID")
        url = f"{self.base_url}/v1/entries/{entry_id}"
        try:
            response = self.http.get(
                url,
                headers={"X-Auth-Token": self.api_token, "Accept": "application/json"},
                timeout=self.timeout_seconds,
                max_bytes=MAX_ENTRY_RESPONSE_BYTES,
                max_redirects=0,
                same_origin=self.base_url,
                allow_private_origin=True,
            )
        except FetchError as exc:
            raise MinifluxError("Miniflux API request failed") from exc
        if response.status == 404:
            raise MinifluxError("entry not found")
        if response.status != 200:
            raise MinifluxError(f"Miniflux API returned HTTP {response.status}")
        try:
            raw = json.loads(response.body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise MinifluxError("Miniflux API returned invalid JSON") from exc
        return _entry_snapshot(raw, expected_id=entry_id)

    def get_current_user_identity(self) -> MinifluxIdentity:
        """Identify the configured service credential without exposing its token."""

        url = f"{self.base_url}/v1/me"
        try:
            response = self.http.get(
                url,
                headers={"X-Auth-Token": self.api_token, "Accept": "application/json"},
                timeout=self.timeout_seconds,
                max_bytes=MAX_IDENTITY_RESPONSE_BYTES,
                max_redirects=0,
                same_origin=self.base_url,
                allow_private_origin=True,
            )
        except FetchError as exc:
            raise MinifluxError("Miniflux identity request failed") from exc
        if response.status != 200:
            raise MinifluxError("Miniflux identity request was not successful")
        try:
            raw = json.loads(response.body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise MinifluxError("Miniflux returned invalid identity JSON") from exc
        if not isinstance(raw, dict):
            raise MinifluxError("Miniflux returned an invalid identity")
        identity_id = _positive_int(raw.get("id"), "identity id")
        username = raw.get("username")
        is_admin = raw.get("is_admin")
        if (
            not isinstance(username, str)
            or not username.strip()
            or len(username) > 256
            or any(ord(char) < 0x20 or ord(char) == 0x7F for char in username)
            or not isinstance(is_admin, bool)
        ):
            raise MinifluxError("Miniflux returned an invalid identity")
        return MinifluxIdentity(identity_id, username, is_admin)

    def get_feed_urlrewrite_rules(self, feed_id: int) -> str:
        if isinstance(feed_id, bool) or not isinstance(feed_id, int) or feed_id <= 0:
            raise MinifluxError("invalid feed ID")
        url = f"{self.base_url}/v1/feeds/{feed_id}"
        try:
            response = self.http.get(
                url,
                headers={"X-Auth-Token": self.api_token, "Accept": "application/json"},
                timeout=self.timeout_seconds,
                max_bytes=MAX_ENTRY_RESPONSE_BYTES,
                max_redirects=0,
                same_origin=self.base_url,
                allow_private_origin=True,
            )
        except FetchError as exc:
            raise MinifluxError("Miniflux feed request failed") from exc
        if response.status == 404:
            raise MinifluxError("feed not found")
        if response.status != 200:
            raise MinifluxError(f"Miniflux API returned HTTP {response.status}")
        try:
            raw = json.loads(response.body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise MinifluxError("Miniflux API returned invalid feed JSON") from exc
        if not isinstance(raw, dict) or _positive_int(raw.get("id"), "feed id") != feed_id:
            raise MinifluxError("Miniflux returned a different feed ID")
        urlrewrite_rules = raw.get("urlrewrite_rules", "")
        if not isinstance(urlrewrite_rules, str):
            raise MinifluxError("Miniflux feed has invalid URL rewrite rules")
        return urlrewrite_rules

    def fetch_entry_content(self, entry_id: int) -> str:
        if isinstance(entry_id, bool) or not isinstance(entry_id, int) or entry_id <= 0:
            raise MinifluxError("invalid entry ID")
        # This is intentionally explicit. Miniflux persists scraped content only when
        # update_content=true; the sidecar must stay response-only.
        url = f"{self.base_url}/v1/entries/{entry_id}/fetch-content?update_content=false"
        try:
            response = self.http.get(
                url,
                headers={"X-Auth-Token": self.api_token, "Accept": "application/json"},
                timeout=self.timeout_seconds,
                max_bytes=MAX_ENTRY_RESPONSE_BYTES,
                max_redirects=0,
                same_origin=self.base_url,
                allow_private_origin=True,
            )
        except FetchError as exc:
            raise MinifluxError("Miniflux content fetch failed") from exc
        if response.status == 404:
            raise MinifluxError("entry not found")
        if response.status != 200:
            raise MinifluxError(f"Miniflux API returned HTTP {response.status}")
        try:
            raw = json.loads(response.body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise MinifluxError("Miniflux API returned invalid content JSON") from exc
        if not isinstance(raw, dict) or not isinstance(raw.get("content"), str):
            raise MinifluxError("Miniflux API returned invalid scraped content")
        return raw["content"]


def _positive_int(value: object, field: str) -> int:
    if isinstance(value, bool):
        raise MinifluxError(f"Miniflux entry has invalid {field}")
    try:
        result = int(value)
    except (TypeError, ValueError) as exc:
        raise MinifluxError(f"Miniflux entry has invalid {field}") from exc
    if result <= 0 or str(result) != str(value).strip():
        raise MinifluxError(f"Miniflux entry has invalid {field}")
    return result


def _entry_snapshot(raw: object, *, expected_id: int) -> EntrySnapshot:
    if not isinstance(raw, dict):
        raise MinifluxError("Miniflux API returned an invalid entry")
    entry_id = _positive_int(raw.get("id"), "id")
    if entry_id != expected_id:
        raise MinifluxError("Miniflux returned a different entry ID")
    feed_id = _positive_int(raw.get("feed_id"), "feed_id")
    title = raw.get("title")
    url = raw.get("url")
    published_at = raw.get("published_at")
    status = raw.get("status")
    starred = raw.get("starred")
    content = raw.get("content")
    if not isinstance(title, str) or not isinstance(url, str) or not url:
        raise MinifluxError("Miniflux entry is missing its title or URL")
    if not isinstance(published_at, str) or not isinstance(status, str):
        raise MinifluxError("Miniflux entry has invalid publication or read status")
    if not isinstance(starred, bool) or not isinstance(content, str):
        raise MinifluxError("Miniflux entry has invalid starred state or content")
    return EntrySnapshot(
        id=entry_id,
        feed_id=feed_id,
        title=title,
        url=url,
        published_at=published_at,
        status=status,
        starred=starred,
        content=content,
    )
