/* eslint-disable react-refresh/only-export-components -- Browser harness entrypoint. */
import "@arco-design/web-react/es/_util/react-19-adapter"
import { Button, Dropdown, Menu } from "@arco-design/web-react"
import "@arco-design/web-react/dist/css/arco.css"
import React, { useCallback, useState } from "react"
import { createRoot } from "react-dom/client"
import { useHotkeys } from "react-hotkeys-hook"

import shouldDeferReaderEscape from "@/utils/reader-escape"

const pause = () => new Promise((resolve) => requestAnimationFrame(() => resolve()))

const waitFor = async (predicate, description) => {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (predicate()) {
      return
    }
    await pause()
  }
  throw new Error(`Timed out waiting for ${description}`)
}

const pressEscape = async (target) => {
  target.focus()
  target.dispatchEvent(
    new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: "Escape",
      key: "Escape",
      keyCode: 27,
      which: 27,
    }),
  )
  await pause()
  target.dispatchEvent(
    new KeyboardEvent("keyup", {
      bubbles: true,
      cancelable: true,
      code: "Escape",
      key: "Escape",
      keyCode: 27,
      which: 27,
    }),
  )
  await pause()
}

const openMenu = async () => {
  document.querySelector('[data-testid="reader-menu-trigger"]').click()
  await waitFor(
    () =>
      document.querySelector(".article-content .arco-dropdown-popup-visible") &&
      document.querySelector('[data-testid="reader-menu-item"]'),
    "reader dropdown to open",
  )
}

const runCase = async (name, fn, collected) => {
  try {
    await fn()
    collected.push({ name, status: "PASS" })
  } catch (error) {
    collected.push({ name, status: "FAIL", detail: error.message })
  }
}

const Harness = () => {
  const [readerOpen, setReaderOpen] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const [nestedMenuOpen, setNestedMenuOpen] = useState(false)
  const [readerCloseCount, setReaderCloseCount] = useState(0)
  const [menuCloseCount, setMenuCloseCount] = useState(0)
  const [renderCount, setRenderCount] = useState(0)
  const [results, setResults] = useState([])
  const [summary, setSummary] = useState("Ready")

  const closeReader = useCallback(() => {
    setReaderCloseCount((count) => count + 1)
    setReaderOpen(false)
  }, [])

  useHotkeys(["esc"], closeReader, {
    eventListenerOptions: { capture: true },
    ignoreEventWhen: shouldDeferReaderEscape,
  })

  const handleMenuVisibleChange = (visible) => {
    setMenuOpen(visible)
    if (!visible) {
      setNestedMenuOpen(false)
      setMenuCloseCount((count) => count + 1)
    }
  }

  const handleMenuKeyDown = (event) => {
    if (event.key !== "Escape") {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    if (nestedMenuOpen) {
      setNestedMenuOpen(false)
    } else {
      handleMenuVisibleChange(false)
    }
  }

  const reset = async () => {
    setReaderOpen(true)
    setMenuOpen(false)
    setNestedMenuOpen(false)
    setReaderCloseCount(0)
    setMenuCloseCount(0)
    setRenderCount(0)
    await pause()
  }

  const runSuite = async () => {
    const collected = []
    setSummary("RUNNING")
    setResults([])

    await runCase(
      "ESCAPE_WITH_NO_TRANSIENT_CLOSES_READER",
      async () => {
        await reset()
        await pressEscape(document.querySelector('[data-testid="reader-focus"]'))
        if (document.querySelector('[data-testid="reader-open"]').textContent !== "closed") {
          throw new Error("reader remained open")
        }
        if (document.querySelector('[data-testid="reader-close-count"]').textContent !== "1") {
          throw new Error("reader close did not run exactly once")
        }
      },
      collected,
    )

    await runCase(
      "FIRST_ESCAPE_CLOSES_MENU_ONLY",
      async () => {
        await reset()
        await openMenu()
        await pressEscape(document.querySelector('[data-testid="reader-menu-trigger"]'))
        if (document.querySelector('[data-testid="reader-open"]').textContent !== "open") {
          throw new Error("reader closed with the menu")
        }
        if (document.querySelector('[data-testid="menu-open"]').textContent !== "closed") {
          throw new Error("menu remained open")
        }
      },
      collected,
    )

    await runCase(
      "SECOND_ESCAPE_CLOSES_READER",
      async () => {
        await reset()
        await openMenu()
        const trigger = document.querySelector('[data-testid="reader-menu-trigger"]')
        await pressEscape(trigger)
        if (document.querySelector('[data-testid="reader-open"]').textContent !== "open") {
          throw new Error("first Escape did not leave the reader open")
        }
        await pressEscape(document.querySelector('[data-testid="reader-focus"]'))
        if (document.querySelector('[data-testid="reader-open"]').textContent !== "closed") {
          throw new Error("second Escape did not close the reader")
        }
      },
      collected,
    )

    await runCase(
      "ONE_ESCAPE_CLOSES_ONE_LAYER",
      async () => {
        await reset()
        await openMenu()
        await pressEscape(document.querySelector('[data-testid="reader-menu-trigger"]'))
        const closeCount = document.querySelector('[data-testid="reader-close-count"]').textContent
        const menuCloseCount = document.querySelector(
          '[data-testid="menu-close-count"]',
        ).textContent
        if (closeCount !== "0" || menuCloseCount !== "1") {
          throw new Error(`expected reader/menu closes 0/1, got ${closeCount}/${menuCloseCount}`)
        }
      },
      collected,
    )

    await runCase(
      "NESTED_ESCAPE_CLOSES_TOPMOST_LAYER_ONLY",
      async () => {
        await reset()
        await openMenu()
        const nestedMenuHeader = document
          .querySelector('[data-testid="nested-menu-trigger"]')
          .closest(".arco-dropdown-menu-pop-header")
        nestedMenuHeader.dispatchEvent(
          new MouseEvent("mouseover", { bubbles: true, relatedTarget: document.body }),
        )
        await waitFor(
          () =>
            document.querySelector(".arco-dropdown-menu-pop-header.arco-dropdown-popup-visible"),
          "nested submenu to open",
        )
        const submenuTrigger = document.querySelector(
          ".arco-dropdown-menu-pop-header.arco-dropdown-popup-visible",
        )
        await pressEscape(submenuTrigger)
        if (document.querySelector('[data-testid="reader-open"]').textContent !== "open") {
          throw new Error("reader closed with the nested menu")
        }
        if (
          !document.querySelector('[data-testid="outer-menu-open"]').textContent.includes("open")
        ) {
          throw new Error("outer menu closed with the nested menu")
        }
        if (document.querySelector(".arco-dropdown-menu-pop-header.arco-dropdown-popup-visible")) {
          throw new Error("topmost nested menu remained open")
        }
        await pressEscape(document.querySelector('[data-testid="reader-menu-trigger"]'))
        if (document.querySelector('[data-testid="reader-open"]').textContent !== "open") {
          throw new Error("second Escape closed the reader instead of the outer menu")
        }
        if (document.querySelector('[data-testid="outer-menu-open"]').textContent !== "closed") {
          throw new Error("outer menu remained open after its Escape")
        }
        await pressEscape(document.querySelector('[data-testid="reader-focus"]'))
        if (document.querySelector('[data-testid="reader-open"]').textContent !== "closed") {
          throw new Error("third Escape did not close the reader")
        }
      },
      collected,
    )

    await runCase(
      "RERENDER_DOES_NOT_DUPLICATE_ESCAPE_LISTENERS",
      async () => {
        await reset()
        for (let index = 0; index < 5; index += 1) {
          document.querySelector('[data-testid="force-rerender"]').click()
          await pause()
        }
        if (document.querySelector('[data-testid="render-count"]').textContent !== "5") {
          throw new Error("rerender fixture did not update five times")
        }
        await pressEscape(document.querySelector('[data-testid="reader-focus"]'))
        const closeCount = document.querySelector('[data-testid="reader-close-count"]').textContent
        if (closeCount !== "1") {
          throw new Error(`reader close listener ran ${closeCount} times`)
        }
      },
      collected,
    )

    setResults(collected)
    setSummary(
      `${collected.filter(({ status }) => status === "PASS").length}/${collected.length} PASS`,
    )
  }

  return (
    <main style={{ fontFamily: "sans-serif", padding: 24 }}>
      <h1>READER-KEY-01 Escape Harness</h1>
      <p>Reader remains mounted until its Escape action closes it.</p>
      <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
        <Button data-testid="run-suite" onClick={runSuite}>
          Run READER-KEY-01 Escape cases
        </Button>
        <Button data-testid="force-rerender" onClick={() => setRenderCount((count) => count + 1)}>
          Force rerender
        </Button>
      </div>
      <dl>
        <dt>Reader</dt>
        <dd data-testid="reader-open">{readerOpen ? "open" : "closed"}</dd>
        <dt>Reader close calls</dt>
        <dd data-testid="reader-close-count">{readerCloseCount}</dd>
        <dt>Menu</dt>
        <dd data-testid="menu-open">{menuOpen ? "open" : "closed"}</dd>
        <dt>Menu close calls</dt>
        <dd data-testid="menu-close-count">{menuCloseCount}</dd>
        <dt>Rerender count</dt>
        <dd data-testid="render-count">{renderCount}</dd>
      </dl>
      {readerOpen && (
        <article
          aria-label="Fixture article reader"
          className="article-content"
          style={{ border: "1px solid #888", minHeight: 220, padding: 16 }}
        >
          <Button data-testid="reader-focus">Reader focus target</Button>
          <Dropdown
            popupVisible={menuOpen}
            trigger="click"
            triggerProps={{ escToClose: true }}
            droplist={
              <Menu onKeyDown={handleMenuKeyDown}>
                <Menu.Item key="reader-menu-item" data-testid="reader-menu-item">
                  Reader menu item
                </Menu.Item>
                <Menu.SubMenu
                  key="nested-reader-menu"
                  title={<span data-testid="nested-menu-trigger">Nested menu</span>}
                  triggerProps={{
                    className: "nested-reader-menu",
                    escToClose: true,
                    onKeyDown: (event) => {
                      if (event.key === "Escape" && nestedMenuOpen) {
                        event.stopPropagation()
                      }
                    },
                    onVisibleChange: setNestedMenuOpen,
                    popupVisible: nestedMenuOpen,
                  }}
                >
                  <Menu.Item key="nested-menu-item">Nested menu item</Menu.Item>
                </Menu.SubMenu>
              </Menu>
            }
            onVisibleChange={handleMenuVisibleChange}
          >
            <Button aria-label="Open reader menu" data-testid="reader-menu-trigger">
              Reader menu
            </Button>
          </Dropdown>
          <span data-testid="outer-menu-open">{menuOpen ? "open" : "closed"}</span>
          <span data-testid="nested-menu-open">{nestedMenuOpen ? "open" : "closed"}</span>
          <p>Fixture reader content</p>
        </article>
      )}
      <p data-testid="suite-summary">{summary}</p>
      <pre data-testid="suite-results">{JSON.stringify(results, null, 2)}</pre>
    </main>
  )
}

const root = createRoot(document.querySelector("#root"))
root.render(<Harness />)

if (import.meta.hot) {
  import.meta.hot.dispose(() => root.unmount())
}
