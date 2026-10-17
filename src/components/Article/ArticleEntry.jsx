import { Divider, Dropdown, Menu } from "@arco-design/web-react/es"
import {
  IconArrowDown,
  IconArrowUp,
  IconBook,
  IconLaunch,
  IconMinusCircle,
  IconRecord,
  IconSave,
  IconStar,
  IconStarFill,
} from "@arco-design/web-react/icon"
import { useStore } from "@nanostores/react"
import classNames from "classnames"
import { memo, useLayoutEffect, useMemo, useRef } from "react"

import useEntryActions from "@/hooks/useEntryActions"
import { polyglotState } from "@/hooks/useLanguage"
import useLongPressContextMenu from "@/hooks/useLongPressContextMenu"
import useMarkRelativeRead from "@/hooks/useMarkRelativeRead"
import { contentState, createEntrySelectedState } from "@/store/contentState"
import { hasIntegrationsState } from "@/store/dataState"
import { articleEntryInteractionSettingsState } from "@/store/settingsState"
import getEntryDisplayTitle from "@/utils/entry-display-title"
import { getRelativeUnreadTargetIds } from "@/utils/relative-read-targets"

import "./ArticleEntry.css"

const ENTRY_CLASS_NAMES = {
  card: "grid-card-wrapper",
  column: "card-wrapper",
  list: "list-entry-wrapper",
}

const NAMED_HTML_ENTITIES = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  quot: '"',
}

const extractTextFromHtml = (html) => {
  if (!html) {
    return ""
  }

  return html
    .replaceAll(/<[^>]*>/g, "")
    .replaceAll("&nbsp;", " ")
    .replaceAll(/&#(\d+);/g, (_match, codePoint) => String.fromCodePoint(codePoint))
    .replaceAll(/&([a-z]+);/g, (_match, entity) => NAMED_HTML_ENTITIES[entity] ?? "")
    .trim()
}

const ArticleEntry = ({
  articleActivation,
  entry,
  layout,
  observeRead,
  presentationClassName,
  presenter: Presenter,
  feedIconMonogramFallback = false,
}) => {
  const { enableContextMenu, markReadOnScroll } = useStore(articleEntryInteractionSettingsState)
  const { infoFrom } = useStore(contentState, { keys: ["infoFrom"] })
  const hasIntegrations = useStore(hasIntegrationsState)
  const { polyglot } = useStore(polyglotState)
  const selectedState = useMemo(() => createEntrySelectedState(entry.id), [entry.id])
  const isSelected = useStore(selectedState)
  const isUnread = entry.status === "unread"
  const isStarred = entry.starred
  const displayTitle = getEntryDisplayTitle(
    entry.title,
    polyglot.t("article_card.untitled_article"),
  )

  const {
    handleSaveToThirdPartyServices,
    handleToggleStarred,
    handleToggleStatus,
    handleOpenLinkExternally,
  } = useEntryActions()
  const { dropdownProps, longPressProps } = useLongPressContextMenu({
    disabled: !enableContextMenu,
  })
  const markRelativeRead = useMarkRelativeRead()
  const entryRef = useRef(null)
  const isContextMenuOpen = dropdownProps.popupVisible
  // Targets are derived from the displayed list only when the menu opens, so closed rows never
  // subscribe to list changes.
  const relativeTargetAvailability = useMemo(() => {
    if (!isContextMenuOpen) {
      return { above: false, below: false }
    }

    const displayedEntries = contentState.get().entries
    return {
      above: getRelativeUnreadTargetIds(displayedEntries, entry.id, "above").length > 0,
      below: getRelativeUnreadTargetIds(displayedEntries, entry.id, "below").length > 0,
    }
  }, [entry.id, isContextMenuOpen])

  useLayoutEffect(() => {
    if (!isUnread || !markReadOnScroll || infoFrom === "history") {
      return
    }

    return observeRead(entryRef.current, entry)
  }, [entry, infoFrom, isUnread, markReadOnScroll, observeRead])

  const previewContent = useMemo(
    () =>
      typeof entry.previewText === "string"
        ? entry.previewText
        : extractTextFromHtml(entry.content),
    [entry.content, entry.previewText],
  )
  const { getPrimaryLinkProps, openInReactFlux, opensSourceOnCardClick } = articleActivation
  const primaryLinkProps = getPrimaryLinkProps(entry)
  const accessibleLabel = isUnread
    ? polyglot.t("article_card.unread_article_aria_label", { title: displayTitle })
    : displayTitle
  const menuOpenAction = opensSourceOnCardClick
    ? {
        icon: <IconBook aria-hidden="true" />,
        key: "open-in-reactflux",
        label: polyglot.t("article_card.open_in_reactflux_tooltip"),
        onClick: () => openInReactFlux(entry),
      }
    : {
        icon: <IconLaunch aria-hidden="true" />,
        key: "open-in-browser",
        label: polyglot.t("article_card.open_link_externally_tooltip"),
        onClick: () => handleOpenLinkExternally(entry),
      }

  return (
    <Dropdown
      {...dropdownProps}
      disabled={!enableContextMenu}
      position="bl"
      trigger="contextMenu"
      droplist={
        <Menu className="mobile-action-menu">
          <Menu.Item key={menuOpenAction.key} onClick={menuOpenAction.onClick}>
            <div className="settings-menu-item">
              <span>{menuOpenAction.label}</span>
              {menuOpenAction.icon}
            </div>
          </Menu.Item>

          <Divider style={{ margin: "4px 0" }} />

          <Menu.Item key="toggle-status" onClick={() => handleToggleStatus(entry)}>
            <div className="settings-menu-item">
              <span>
                {isUnread
                  ? polyglot.t("article_card.mark_as_read_tooltip")
                  : polyglot.t("article_card.mark_as_unread_tooltip")}
              </span>
              {isUnread ? (
                <IconMinusCircle aria-hidden="true" />
              ) : (
                <IconRecord aria-hidden="true" />
              )}
            </div>
          </Menu.Item>

          <Menu.Item key="toggle-starred" onClick={() => handleToggleStarred(entry)}>
            <div className="settings-menu-item">
              <span>
                {isStarred
                  ? polyglot.t("article_card.unstar_tooltip")
                  : polyglot.t("article_card.star_tooltip")}
              </span>
              {isStarred ? (
                <IconStarFill aria-hidden="true" style={{ color: "var(--nf-favorite)" }} />
              ) : (
                <IconStar aria-hidden="true" />
              )}
            </div>
          </Menu.Item>

          {hasIntegrations && (
            <Menu.Item
              key="save-to-third-party-services"
              onClick={() => handleSaveToThirdPartyServices(entry)}
            >
              <div className="settings-menu-item">
                <span>{polyglot.t("article_card.save_to_third_party_services_tooltip")}</span>
                <IconSave aria-hidden="true" />
              </div>
            </Menu.Item>
          )}

          <Divider style={{ margin: "4px 0" }} />

          <Menu.Item
            key="mark-articles-above-read"
            aria-disabled={!relativeTargetAvailability.above}
            disabled={!relativeTargetAvailability.above}
            onClick={() => void markRelativeRead(entry.id, "above")}
          >
            <div className="settings-menu-item">
              <span>{polyglot.t("article_card.mark_articles_above_as_read_tooltip")}</span>
              <IconArrowUp aria-hidden="true" />
            </div>
          </Menu.Item>

          <Menu.Item
            key="mark-articles-below-read"
            aria-disabled={!relativeTargetAvailability.below}
            disabled={!relativeTargetAvailability.below}
            onClick={() => void markRelativeRead(entry.id, "below")}
          >
            <div className="settings-menu-item">
              <span>{polyglot.t("article_card.mark_articles_below_as_read_tooltip")}</span>
              <IconArrowDown aria-hidden="true" />
            </div>
          </Menu.Item>
        </Menu>
      }
    >
      <a
        {...primaryLinkProps}
        ref={entryRef}
        {...longPressProps}
        aria-label={accessibleLabel}
        data-entry-id={entry.id}
        className={classNames("article-entry", ENTRY_CLASS_NAMES[layout], presentationClassName, {
          "context-menu-enabled": enableContextMenu,
          read: !isUnread,
          selected: isSelected,
          unread: isUnread,
        })}
      >
        <Presenter
          displayTitle={displayTitle}
          entry={entry}
          feedIconMonogramFallback={feedIconMonogramFallback}
          previewContent={previewContent}
        />
      </a>
    </Dropdown>
  )
}

export default memo(ArticleEntry)
