/* eslint-disable react-refresh/only-export-components -- Browser harness entrypoint. */
import "@arco-design/web-react/es/_util/react-19-adapter"
import "@arco-design/web-react/dist/css/arco.css"
import Polyglot from "node-polyglot"
import React, { useRef } from "react"
import { createRoot } from "react-dom/client"
import { MemoryRouter } from "react-router"

import ActionButtons from "@/components/Article/ActionButtons"
import AdaptiveScrollArea from "@/components/ui/AdaptiveScrollArea"
import AppDataContext from "@/contexts/app-data-context"
import DesktopSidebarContext from "@/contexts/desktop-sidebar-context"
import ReaderCommandsContext from "@/contexts/reader-commands-context"
import { polyglotState } from "@/hooks/useLanguage"
import englishPhrases from "@/locales/en-US.json"
import { contentState } from "@/store/contentState"
import { dataState } from "@/store/dataState"
import { getDefaultSettings, getSettings, replaceSettings } from "@/store/settingsState"
import "@/App.css"
import "simplebar-react/dist/simplebar.min.css"
import "@/theme.css"
import "@/liquid-glass.css"
import "@/components/Article/ArticleDetail.css"
import "@/components/Article/ActionButtons.css"
import "@/components/Article/ReaderStyles.css"

const category = { id: 1, title: "News", hide_globally: false }
const feed = {
  id: 1,
  title: "Tech News",
  category,
  hide_globally: false,
  site_url: "https://example.invalid/feed",
}
const activeEntry = {
  id: 101,
  title: "Long Article for Interaction-Aware Chrome Testing",
  content: "<p>Initial paragraph.</p>",
  headings: [{ id: "heading-1", level: 2, text: "Section 1" }],
  comments_url: "",
  feed,
  status: "unread",
  starred: false,
}

polyglotState.setKey("polyglot", new Polyglot({ phrases: englishPhrases, locale: "en-US" }))
replaceSettings({
  ...getDefaultSettings(),
  showStatus: "unread",
  enableSwipeGesture: false,
})
dataState.set({
  ...dataState.get(),
  categoriesData: [category],
  feedsData: [feed],
  hasIntegrations: true,
  loadState: {
    ...dataState.get().loadState,
    catalog: { ...dataState.get().loadState.catalog, hasSnapshot: true },
  },
  unreadInfo: { 1: 1 },
})
contentState.set({
  ...contentState.get(),
  activeContent: activeEntry,
  entries: [activeEntry],
  infoFrom: "feed",
  infoId: 1,
  isArticleListReady: true,
  total: 1,
})

const desktopSidebar = {
  detailCloseButtonRef: { current: null },
  isDetailActive: true,
}

const readerCommands = {
  canNavigateNext: true,
  canNavigatePrevious: true,
  exitDetailView: () => {},
  isResolving: false,
  navigateToNextArticle: () => {},
  navigateToPreviousArticle: () => {},
}

const Harness = () => {
  const scrollContainerRef = useRef(null)
  const [isPhotoSliderVisible, setIsPhotoSliderVisible] = React.useState(false)

  React.useEffect(() => {
    globalThis.__READER_SET_LIGHTBOX__ = (visible) => {
      setIsPhotoSliderVisible(visible)
    }
  }, [])

  return (
    <DesktopSidebarContext.Provider value={desktopSidebar}>
      <ReaderCommandsContext.Provider value={readerCommands}>
        <AppDataContext.Provider value={{ refreshCounts: async () => ({}) }}>
          <MemoryRouter initialEntries={["/article/101"]}>
            <div
              className="article-container article-container-full-size"
              style={{
                height: "100vh",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <AdaptiveScrollArea
                ref={scrollContainerRef}
                className="scroll-container"
                scrollableNodeProps={{ tabIndex: -1 }}
                style={{ height: "100%" }}
              >
                <ActionButtons
                  isPhotoSliderVisible={isPhotoSliderVisible}
                  scrollContainerRef={scrollContainerRef}
                />
                <div
                  className="article-content"
                  style={{
                    padding: "20px 24px",
                    minHeight: "3500px",
                    boxSizing: "border-box",
                  }}
                >
                  <h1 style={{ marginTop: "40px" }}>{activeEntry.title}</h1>
                  <p>
                    Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor
                    incididunt ut labore et dolore magna aliqua.
                  </p>
                  {Array.from({ length: 40 }).map((_, index) => (
                    <p key={index} style={{ marginBottom: "40px" }}>
                      Paragraph {index + 1}: Continuous long reading prose text to verify scroll
                      threshold accumulation, deterministic retreat on downward reading, prompt
                      upward return, and keyboard accessibility.
                    </p>
                  ))}
                </div>
              </AdaptiveScrollArea>
            </div>
          </MemoryRouter>
        </AppDataContext.Provider>
      </ReaderCommandsContext.Provider>
    </DesktopSidebarContext.Provider>
  )
}

function resolveScrollElement() {
  const elements = [
    document.querySelector(".action-buttons")?.closest(".simplebar-content-wrapper"),
    document.querySelector(".action-buttons")?.closest(".adaptive-scroll-area-native"),
    document
      .querySelector(".action-buttons")
      ?.closest(".scroll-container")
      ?.querySelector(".simplebar-content-wrapper"),
    document
      .querySelector(".action-buttons")
      ?.closest(".scroll-container")
      ?.querySelector(".adaptive-scroll-area-native"),
    document.querySelector(".simplebar-content-wrapper"),
    document.querySelector(".adaptive-scroll-area-native"),
    document.querySelector(".scroll-container"),
  ]
  return elements.find((el) => el && el.isConnected) || null
}

globalThis.__READER_TEST__ = {
  blurButton: () => {
    if (document.activeElement && document.activeElement !== document.body) {
      document.activeElement.blur()
    }
    document.body.focus()
  },
  changeArticle: (newId) => {
    contentState.set({
      ...contentState.get(),
      activeContent: { ...contentState.get().activeContent, id: newId },
    })
  },
  closeCompactToc: () => {
    const heading = document.querySelector(
      ".toc-menu-item, .toc-droplist-container .arco-dropdown-menu-item",
    )
    if (heading) {
      heading.click()
      return true
    }
    const backBtn = document.querySelector(".toc-back-button")
    if (backBtn) {
      backBtn.click()
      return true
    }
    return false
  },
  focusButton: () => {
    const btn = document.querySelector(".action-buttons button")
    if (btn) {
      btn.focus({ preventScroll: true })
      return true
    }
    return false
  },
  focusProse: () => {
    let proseEl = document.querySelector(".article-content [tabindex='-1']")
    if (!proseEl) {
      proseEl = document.querySelector(".article-content p")
      proseEl?.setAttribute("tabindex", "-1")
    }
    if (proseEl) {
      proseEl.focus({ preventScroll: true })
      return true
    }
    return false
  },
  getChromeState: () => {
    const chrome = document.querySelector(".action-buttons")
    if (!chrome) {
      return null
    }
    const style = globalThis.getComputedStyle(chrome)
    return {
      classList: [...chrome.classList],
      dataState: chrome.dataset.chromeState,
      hasHiddenClass: chrome.classList.contains("chrome-hidden"),
      isFocusWithin: chrome.matches(":focus-within"),
      opacity: style.opacity,
      pointerEvents: style.pointerEvents,
      scrollTop: resolveScrollElement()?.scrollTop,
      transform: style.transform,
      transition: style.transition,
    }
  },
  getScrollTop: () => {
    const el = resolveScrollElement()
    return el ? el.scrollTop : 0
  },
  hasNavigationArrows: () => {
    const prev = document.querySelector(".action-buttons button[aria-label*='Previous article']")
    const next = document.querySelector(".action-buttons button[aria-label*='Next article']")
    return {
      hasNext: Boolean(next),
      hasPrevious: Boolean(prev),
    }
  },
  focusToc: () => {
    const el = document.querySelector(
      ".toc-droplist-container input, .toc-droplist-container .arco-dropdown-menu-item, .toc-droplist-container",
    )
    if (el) {
      el.focus?.({ preventScroll: true })
      return true
    }
    return false
  },
  openCompactToc: () => {
    const items = [
      ...document.querySelectorAll(
        ".mobile-action-menu .arco-dropdown-menu-item, .settings-dropdown .arco-dropdown-menu-item",
      ),
    ]
    const target = items.find(
      (el) =>
        el.textContent.includes("Table of Contents") ||
        el.querySelector(".arco-icon-unordered-list"),
    )
    if (target) {
      target.click()
      return true
    }
    return false
  },
  openDesktopToc: () => {
    const tocBtn = document.querySelector(
      ".action-buttons button[aria-label='Table of Contents'], .action-buttons button[aria-label*='Table of Contents']",
    )
    if (tocBtn) {
      tocBtn.click()
      return true
    }
    return false
  },
  closeDesktopToc: () => {
    const heading = document.querySelector(".toc-menu-item")
    if (heading) {
      heading.click()
      return true
    }
    const tocBtn = document.querySelector(
      ".action-buttons button[aria-label='Table of Contents'], .action-buttons button[aria-label*='Table of Contents']",
    )
    if (tocBtn) {
      tocBtn.click()
      return true
    }
    return false
  },
  closeMoreMenu: () => {
    const menu = document.querySelector(".mobile-action-menu")
    if (menu) {
      menu.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, code: "Escape", key: "Escape" }),
      )
      return true
    }
    const moreBtn = document.querySelector(
      ".action-buttons button[aria-label*='More actions'], .action-buttons .settings-dropdown button",
    )
    if (moreBtn) {
      moreBtn.click()
      return true
    }
    return false
  },
  focusMoreMenu: () => {
    const item = document.querySelector(".mobile-action-menu .arco-dropdown-menu-item")
    if (item) {
      item.focus({ preventScroll: true })
      return true
    }
    return false
  },
  openMoreMenu: () => {
    const moreBtn = document.querySelector(
      ".action-buttons button[aria-label*='More actions'], .action-buttons .settings-dropdown button",
    )
    if (moreBtn) {
      moreBtn.focus({ preventScroll: true })
      moreBtn.click()
      return true
    }
    return false
  },
  scrollBy: (delta) => {
    const el = resolveScrollElement()
    if (el) {
      el.scrollTop += delta
      el.dispatchEvent(new Event("scroll"))
    }
  },
  scrollTo: (top) => {
    const el = resolveScrollElement()
    if (el) {
      el.scrollTop = top
      el.dispatchEvent(new Event("scroll"))
    }
  },
  setLightboxVisible: (visible) => {
    if (globalThis.__READER_SET_LIGHTBOX__) {
      globalThis.__READER_SET_LIGHTBOX__(visible)
      return true
    }
    return false
  },
  setSwipeGestureEnabled: (enabled) => {
    const current = getSettings()
    replaceSettings({
      ...current,
      enableSwipeGesture: enabled,
    })
    return true
  },
}

createRoot(document.querySelector("#root")).render(<Harness />)
