import { Button } from "@arco-design/web-react"
import { IconCheck } from "@arco-design/web-react/icon"
import { useStore } from "@nanostores/react"
import { memo } from "react"

import { polyglotState } from "@/hooks/useLanguage"

const ArticleSelectionControls = memo(
  ({
    available,
    disabled,
    mode,
    selectedCount,
    busy,
    selectTriggerRef,
    onEnter,
    onCancel,
    onMarkAsRead,
  }) => {
    const { polyglot } = useStore(polyglotState)

    if (!available) {
      return null
    }

    if (!mode) {
      return (
        <Button
          ref={selectTriggerRef}
          className="nf-glass-control article-selection-trigger"
          disabled={disabled}
          onClick={onEnter}
        >
          {polyglot.t("article_selection.select_articles")}
        </Button>
      )
    }

    return (
      <div className="article-selection-controls">
        <span aria-live="polite" className="article-selection-count" role="status">
          {polyglot.t("article_selection.selected_count", { smart_count: selectedCount })}
        </span>
        <Button
          data-selection-primary
          className="nf-glass-control article-selection-mark-read"
          disabled={disabled || busy || selectedCount === 0}
          loading={busy}
          onClick={onMarkAsRead}
        >
          <IconCheck aria-hidden="true" />
          {polyglot.t("article_selection.mark_as_read")}
        </Button>
        <Button data-selection-fallback disabled={busy} onClick={onCancel}>
          {polyglot.t("article_selection.cancel")}
        </Button>
      </div>
    )
  },
)

ArticleSelectionControls.displayName = "ArticleSelectionControls"

export default ArticleSelectionControls
