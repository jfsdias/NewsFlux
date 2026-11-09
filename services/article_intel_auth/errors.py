from __future__ import annotations

_SAFE_MESSAGES = {
    "https_required": "The NewsFlux AI request must use HTTPS.",
    "unauthenticated": "A valid Miniflux API key is required.",
    "request_origin_not_allowed": "The request origin is not authorized.",
    "miniflux_origin_not_authorized": "The configured Miniflux server is not authorized for AI.",
    "miniflux_unavailable": "Miniflux identity service is unavailable.",
    "invalid_miniflux_response": "Miniflux returned an invalid identity or entry response.",
    "admin_not_authorized": "Administrative access is not authorized.",
    "entry_not_accessible": "The requested entry is not accessible.",
    "invalid_request": "The authenticated request is invalid.",
    "client_identity_claim_not_allowed": "Client-supplied identity claims are not accepted.",
}


class AuthError(Exception):
    """Public-safe authorization failure; never contains upstream bodies or credentials."""

    def __init__(self, code: str, status_code: int) -> None:
        self.code = code
        self.status_code = status_code
        super().__init__(_SAFE_MESSAGES.get(code, "The request could not be authorized."))
