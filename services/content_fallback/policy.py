from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import urlsplit

STATES = {"DISABLED", "ON_DEMAND", "PRELOAD_RECENT"}
PROVIDERS = {"miniflux", "wallhop"}


def _domain(value: object) -> str:
    if not isinstance(value, str) or not value or value.strip() != value:
        raise ValueError("policy domains must be non-empty bare hostnames")
    if any(char in value for char in "/:@?#* \\%"):
        raise ValueError("policy domains must be bare hostnames without wildcards")
    try:
        result = value.casefold().encode("idna").decode("ascii")
    except UnicodeError as exc:
        raise ValueError("policy domain is not valid IDNA") from exc
    if len(result) > 253 or result.startswith(".") or result.endswith("."):
        raise ValueError("policy domain is malformed")
    labels = result.split(".")
    if any(not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label) for label in labels):
        raise ValueError("policy domain is malformed")
    return result


@dataclass(frozen=True)
class DomainPolicy:
    state: str = "DISABLED"
    provider: str = "wallhop"

    @classmethod
    def from_dict(cls, value: object) -> DomainPolicy:
        if not isinstance(value, dict):
            raise ValueError("each fallback policy must be an object")
        state = value.get("state", "DISABLED")
        provider = value.get("provider", "wallhop")
        if state not in STATES:
            raise ValueError(f"state must be one of {sorted(STATES)}")
        if provider not in PROVIDERS:
            raise ValueError("P0 providers are Miniflux native scraping and WallHop; 13ft is security-gated")
        return cls(state=state, provider=provider)


@dataclass(frozen=True)
class PolicyDecision:
    policy: DomainPolicy | None
    reason: str

    @property
    def on_demand(self) -> bool:
        return self.policy is not None and self.policy.state == "ON_DEMAND" and self.reason == "enabled"


class PolicyRegistry:
    """Explicit feed/domain allowlist; an absent policy always means disabled."""

    def __init__(
        self,
        *,
        enabled: bool = False,
        domains: dict[str, DomainPolicy] | None = None,
        feeds: dict[int, DomainPolicy] | None = None,
    ) -> None:
        self.enabled = enabled
        self.domains = {_domain(key): value for key, value in (domains or {}).items()}
        self.feeds = dict(feeds or {})

    @classmethod
    def from_dict(cls, value: object) -> PolicyRegistry:
        if not isinstance(value, dict):
            raise ValueError("policy configuration must be an object")
        enabled = value.get("enabled", False)
        if not isinstance(enabled, bool):
            raise ValueError("enabled must be a boolean")
        raw_domains = value.get("domains", {})
        raw_feeds = value.get("feeds", {})
        if not isinstance(raw_domains, dict) or not isinstance(raw_feeds, dict):
            raise ValueError("domains and feeds must be objects")
        domains = {_domain(host): DomainPolicy.from_dict(policy) for host, policy in raw_domains.items()}
        feeds: dict[int, DomainPolicy] = {}
        for raw_id, policy in raw_feeds.items():
            if not isinstance(raw_id, str) or not raw_id.isdigit() or int(raw_id) <= 0:
                raise ValueError("feed policy keys must be positive integer IDs")
            feeds[int(raw_id)] = DomainPolicy.from_dict(policy)
        return cls(enabled=enabled, domains=domains, feeds=feeds)

    def decide(self, *, url: str, feed_id: int) -> PolicyDecision:
        if not self.enabled:
            return PolicyDecision(None, "feature_disabled")
        try:
            host = (urlsplit(url).hostname or "").casefold().encode("idna").decode("ascii")
        except (UnicodeError, ValueError):
            return PolicyDecision(None, "invalid_source_host")
        policy = self.feeds.get(feed_id)
        if policy is None:
            for root, configured in self.domains.items():
                if host == root or host.endswith("." + root):
                    policy = configured
                    break
        if policy is None or policy.state == "DISABLED":
            return PolicyDecision(policy, "domain_disabled" if policy else "unknown_domain")
        if policy.state == "PRELOAD_RECENT":
            return PolicyDecision(policy, "preload_not_available_in_p0")
        return PolicyDecision(policy, "enabled")
