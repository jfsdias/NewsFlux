import { IconTool } from "@arco-design/web-react/icon"

export const HOME_TOOLS_PANEL_ID = "home-tools-panel"

/**
 * Single discreet entry point for the optional Home tools (editorial tools and source
 * recommendations). Expansion is transient component state owned by HomeEditorial and
 * resets to collapsed on every load; nothing here is persisted.
 */
export const HomeToolsTrigger = ({ buttonRef, open, polyglot, onToggle }) => (
  <button
    ref={buttonRef}
    aria-controls={HOME_TOOLS_PANEL_ID}
    aria-expanded={open}
    className="home-tools-trigger"
    type="button"
    onClick={onToggle}
  >
    <IconTool aria-hidden="true" />
    <span>{polyglot.t("home_page.tools")}</span>
  </button>
)

/**
 * The panel stays mounted while collapsed so opt-in state inside the tools survives
 * collapsing; `hidden` keeps its contents out of the tab order and accessibility tree.
 */
export const HomeToolsPanel = ({ children, open, polyglot, onClose }) => (
  <div
    aria-label={polyglot.t("home_page.tools")}
    className="home-tools-panel"
    hidden={!open}
    id={HOME_TOOLS_PANEL_ID}
    role="group"
    onKeyDown={(event) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }
    }}
  >
    {children}
  </div>
)
