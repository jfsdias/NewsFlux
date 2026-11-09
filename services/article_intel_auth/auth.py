from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from collections.abc import Mapping

from services.article_intel_auth.config import AuthSettings, AuthConfigurationError, canonicalize_miniflux_base_url
from services.article_intel_auth.errors import AuthError
from services.article_intel_auth.origin import OriginPolicy
from services.content_fallback.http_client import FetchError, HTTPResponse, PinnedHTTPClient

MAX_IDENTITY_RESPONSE_BYTES = 64 * 1024
MAX_ENTRY_RESPONSE_BYTES = 2 * 1024 * 1024
MAX_API_KEY_LENGTH = 4096
MAX_ENTRY_ID = 9_223_372_036_854_775_807
DEFAULT_TIMEOUT_SECONDS = 5.0
_USER_AGENT = "NewsFlux-ArticleIntelAuth/0.1"
_CLIENT_IDENTITY_FIELDS = frozenset({"userid", "isadmin", "principalid", "tenantid", "minifluxuserid", "role", "roles"})


@dataclass(frozen=True)
class AuthenticatedPrincipal:
    miniflux_base_url: str
    user_id: int
    username: str
    is_admin: bool


@dataclass(frozen=True)
class AuthorizedEntry:
    entry_id: int
    feed_id: int
    user_id: int
    title: str
    content_html: str
    content_sha256: str
    url_fingerprint: str


class MinifluxAuthService:
    """Per-request Miniflux identity and resource authorization, with no credential cache."""

    def __init__(
        self,
        settings: AuthSettings,
        *,
        http: PinnedHTTPClient | None = None,
        timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
    ) -> None:
        if not isinstance(timeout_seconds, (int, float)) or isinstance(timeout_seconds, bool) or not 0 < timeout_seconds <= 15:
            raise ValueError("timeout_seconds must be between 0 and 15")
        self.settings = settings
        self.origin_policy = OriginPolicy(settings.allowed_web_origins)
        self.http = http or PinnedHTTPClient()
        self.timeout_seconds = float(timeout_seconds)

    def authenticate(
        self,
        *,
        api_key: str | None,
        claimed_miniflux_base_url: str | None,
        request_origin: str | None,
        request_is_secure: bool = False,
        client_claims: Mapping[str, object] | None = None,
    ) -> AuthenticatedPrincipal:
        if request_is_secure is not True:
            raise AuthError("https_required", 400)
        self.origin_policy.validate_origin(request_origin)
        self._reject_client_identity_claims(client_claims)
        self._assert_authorized_miniflux_base(claimed_miniflux_base_url)
        self._validate_api_key(api_key)

        payload = self._get_json("/v1/me", api_key, max_bytes=MAX_IDENTITY_RESPONSE_BYTES)
        if not isinstance(payload, dict):
            raise AuthError("invalid_miniflux_response", 502)
        user_id = _strict_positive_int(payload.get("id"))
        username = payload.get("username")
        is_admin = payload.get("is_admin")
        if (
            user_id is None
            or not isinstance(username, str)
            or not username.strip()
            or len(username) > 256
            or any(ord(char) < 0x20 or ord(char) == 0x7F for char in username)
        ):
            raise AuthError("invalid_miniflux_response", 502)
        if not isinstance(is_admin, bool):
            raise AuthError("invalid_miniflux_response", 502)
        return AuthenticatedPrincipal(
            miniflux_base_url=self.settings.miniflux_base_url,
            user_id=user_id,
            username=username,
            is_admin=is_admin,
        )

    def authorize_admin(
        self,
        *,
        api_key: str | None,
        claimed_miniflux_base_url: str | None,
        request_origin: str | None,
        request_is_secure: bool = False,
        client_claims: Mapping[str, object] | None = None,
    ) -> AuthenticatedPrincipal:
        principal = self.authenticate(
            api_key=api_key,
            claimed_miniflux_base_url=claimed_miniflux_base_url,
            request_origin=request_origin,
            request_is_secure=request_is_secure,
            client_claims=client_claims,
        )
        if (
            not principal.is_admin
            or self.settings.admin_allowlist_state != "configured"
            or not self.settings.admin_user_ids
            or principal.user_id not in self.settings.admin_user_ids
        ):
            raise AuthError("admin_not_authorized", 403)
        return principal

    def authorize_entry(
        self,
        *,
        api_key: str | None,
        claimed_miniflux_base_url: str | None,
        request_origin: str | None,
        entry_id: int,
        request_is_secure: bool = False,
        client_claims: Mapping[str, object] | None = None,
    ) -> AuthorizedEntry:
        if _strict_positive_int(entry_id) is None:
            raise AuthError("invalid_request", 400)
        principal = self.authenticate(
            api_key=api_key,
            claimed_miniflux_base_url=claimed_miniflux_base_url,
            request_origin=request_origin,
            request_is_secure=request_is_secure,
            client_claims=client_claims,
        )
        payload = self._get_json(
            f"/v1/entries/{entry_id}",
            api_key,
            max_bytes=MAX_ENTRY_RESPONSE_BYTES,
            entry_request=True,
        )
        if not isinstance(payload, dict):
            raise AuthError("invalid_miniflux_response", 502)

        returned_id = _strict_positive_int(payload.get("id"))
        owner_id = _strict_positive_int(payload.get("user_id"))
        feed_id = _strict_positive_int(payload.get("feed_id"))
        feed = payload.get("feed")
        title = payload.get("title")
        source_url = payload.get("url")
        content = payload.get("content")
        if (
            returned_id != entry_id
            or owner_id != principal.user_id
            or feed_id is None
            or not isinstance(feed, dict)
            or _strict_positive_int(feed.get("id")) != feed_id
            or _strict_positive_int(feed.get("user_id")) != principal.user_id
        ):
            raise AuthError("entry_not_accessible", 404)
        if (
            not isinstance(title, str)
            or len(title) > 16_384
            or not isinstance(source_url, str)
            or not source_url
            or len(source_url) > 8192
            or any(char in source_url for char in "\r\n\x00")
            or not isinstance(content, str)
        ):
            raise AuthError("invalid_miniflux_response", 502)
        try:
            content_digest = hashlib.sha256(content.encode("utf-8", errors="strict")).hexdigest()
            url_fingerprint = hashlib.sha256(source_url.encode("utf-8", errors="strict")).hexdigest()
        except UnicodeError:
            raise AuthError("invalid_miniflux_response", 502) from None
        return AuthorizedEntry(
            entry_id=entry_id,
            feed_id=feed_id,
            user_id=principal.user_id,
            title=title,
            content_html=content,
            content_sha256=content_digest,
            url_fingerprint=url_fingerprint,
        )

    def _assert_authorized_miniflux_base(self, claimed_base: str | None) -> None:
        if not isinstance(claimed_base, str):
            raise AuthError("miniflux_origin_not_authorized", 403)
        try:
            canonical = canonicalize_miniflux_base_url(claimed_base)
        except AuthConfigurationError:
            raise AuthError("miniflux_origin_not_authorized", 403) from None
        if canonical != self.settings.miniflux_base_url:
            raise AuthError("miniflux_origin_not_authorized", 403)

    @staticmethod
    def _validate_api_key(api_key: str | None) -> None:
        if (
            not isinstance(api_key, str)
            or not api_key
            or len(api_key) > MAX_API_KEY_LENGTH
            or api_key != api_key.strip()
            or not api_key.isascii()
            or any(ord(char) < 0x21 or ord(char) > 0x7E for char in api_key)
        ):
            raise AuthError("unauthenticated", 401)

    @staticmethod
    def _reject_client_identity_claims(client_claims: Mapping[str, object] | None) -> None:
        if client_claims is None:
            return
        if not isinstance(client_claims, Mapping):
            raise AuthError("invalid_request", 400)
        normalized = {"".join(char for char in str(key).casefold() if char.isalnum()) for key in client_claims}
        if normalized.intersection(_CLIENT_IDENTITY_FIELDS):
            raise AuthError("client_identity_claim_not_allowed", 400)

    def _get_json(
        self,
        path: str,
        api_key: str,
        *,
        max_bytes: int,
        entry_request: bool = False,
    ) -> object:
        url = f"{self.settings.miniflux_base_url}{path}"
        try:
            response = self.http.get(
                url,
                headers={
                    "X-Auth-Token": api_key,
                    "Accept": "application/json",
                    "User-Agent": _USER_AGENT,
                },
                timeout=self.timeout_seconds,
                max_bytes=max_bytes,
                max_redirects=0,
                same_origin=self.settings.miniflux_base_url,
                allow_private_origin=True,
            )
        except (FetchError, TimeoutError, OSError):
            raise AuthError("miniflux_unavailable", 502) from None

        if (
            not isinstance(response, HTTPResponse)
            or isinstance(response.status, bool)
            or not isinstance(response.status, int)
            or not isinstance(response.body, bytes)
            or not isinstance(response.headers, dict)
        ):
            raise AuthError("invalid_miniflux_response", 502)
        if len(response.body) > max_bytes:
            raise AuthError("invalid_miniflux_response", 502)
        if response.status in {401, 403}:
            if entry_request and response.status == 403:
                raise AuthError("entry_not_accessible", 404)
            raise AuthError("unauthenticated", 401)
        if response.status == 404 and entry_request:
            raise AuthError("entry_not_accessible", 404)
        if response.status != 200:
            raise AuthError("miniflux_unavailable", 502)
        raw_content_type = response.headers.get("content-type", "")
        if not isinstance(raw_content_type, str):
            raise AuthError("invalid_miniflux_response", 502)
        content_type = raw_content_type.split(";", 1)[0].strip().casefold()
        if content_type != "application/json":
            raise AuthError("invalid_miniflux_response", 502)
        try:
            return json.loads(response.body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise AuthError("invalid_miniflux_response", 502) from None


def _strict_positive_int(value: object) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= MAX_ENTRY_ID:
        return None
    return value
