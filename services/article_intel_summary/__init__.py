"""Article summary API primitives; no provider or production runtime is enabled by default."""

from services.article_intel_summary.app import create_app
from services.article_intel_summary.content import ContentSnapshotResolver, ResolvedContentSnapshot
from services.article_intel_summary.service import SummaryService

__all__ = ["ContentSnapshotResolver", "ResolvedContentSnapshot", "SummaryService", "create_app"]
