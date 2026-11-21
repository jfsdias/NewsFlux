import classNames from "classnames"
import { useEffect, useId, useRef, useState } from "react"

import { filterModelOptions } from "@/utils/summary-model-options"

/**
 * Searchable model picker: WAI-ARIA editable combobox with a list popup (input + listbox,
 * aria-activedescendant). The list opens in the page flow, under the field, so the settings
 * modal's scroll area never clips it. Disabled options stay listed and announced, but cannot be
 * chosen.
 *
 * Keyboard: ↓/↑ open the list and move; Alt+↓ opens, Alt+↑ closes; Enter chooses; Escape
 * closes the list without leaving the settings; typing filters (label, provider, ID).
 *
 * options: [{ type, value, disabled, model, label, description }] from summary-model-options,
 * with the display texts added by the caller.
 */
const ModelCombobox = ({ details, label, noResults, onChange, options, placeholder, value }) => {
  const baseId = useId()
  const listId = `${baseId}-listbox`
  const detailsId = `${baseId}-details`
  const statusId = `${baseId}-status`
  const inputRef = useRef(null)
  const listRef = useRef(null)
  // Selection in the closed field (which shows the chosen label), read before each edit.
  const selectionRef = useRef({ start: 0, end: 0 })
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [activeIndex, setActiveIndex] = useState(-1)

  const selected = options.find((option) => option.value === value)
  const visible = open ? filterModelOptions(options, query) : options
  const active = open ? visible[activeIndex] : undefined
  const optionId = (index) => `${baseId}-option-${index}`
  const noMatch = open && query.trim() !== "" && !visible.some((option) => option.type === "model")

  useEffect(() => {
    if (open && activeIndex !== -1) {
      listRef.current?.children[activeIndex]?.scrollIntoView?.({ block: "nearest" })
    }
  }, [open, activeIndex])

  // When the list closes with focus still in the field (a choice, Escape, Alt+↑), the shown
  // label is selected again, so the next input (typed, pasted or composed by an IME) replaces
  // it as a whole instead of editing it mid-composition.
  useEffect(() => {
    const input = inputRef.current
    if (!open && input && document.activeElement === input) {
      input.select()
      selectionRef.current = { start: 0, end: input.value.length }
    }
  }, [open, value])

  const openList = () => {
    setQuery("")
    setActiveIndex(Math.max(0, options.indexOf(selected)))
    setOpen(true)
  }

  const closeList = () => {
    setOpen(false)
    setQuery("")
    setActiveIndex(-1)
  }

  const choose = (option) => {
    if (!option || option.disabled) {
      return
    }
    if (option.value !== value) {
      onChange(option.value)
    }
    closeList()
  }

  const move = (delta) => {
    if (visible.length === 0) {
      return
    }
    setActiveIndex((index) => Math.min(visible.length - 1, Math.max(0, index + delta)))
  }

  const rememberSelection = (event) => {
    selectionRef.current = {
      start: event.target.selectionStart ?? 0,
      end: event.target.selectionEnd ?? 0,
    }
  }

  const onKeyDown = (event) => {
    if (!open) {
      rememberSelection(event)
    }
    switch (event.key) {
      case "ArrowDown": {
        event.preventDefault()
        if (!open) {
          openList()
        } else if (!event.altKey) {
          move(1)
        }
        break
      }
      case "ArrowUp": {
        event.preventDefault()
        if (!open) {
          openList()
        } else if (event.altKey) {
          closeList()
        } else {
          move(-1)
        }
        break
      }
      case "Enter": {
        if (open) {
          event.preventDefault()
          choose(active)
        }
        break
      }
      case "Escape": {
        if (open) {
          // Close the list only; the settings dialog stays open.
          event.preventDefault()
          event.stopPropagation()
          closeList()
        }
        break
      }
      case "Tab": {
        closeList()
        break
      }
      default:
    }
  }

  const onQueryChange = (event) => {
    let next = event.target.value
    if (!open) {
      // Closed, the field shows the chosen label. The search is only what this edit inserted
      // (typed, pasted or composed) in place of the selection; a deletion starts an empty
      // search. Never the label plus or minus the typed text.
      const shown = selected?.label ?? ""
      const { start, end } = selectionRef.current
      const keptAfter = shown.length - end
      next = next.length - keptAfter > start ? next.slice(start, next.length - keptAfter) : ""
    }
    const matches = filterModelOptions(options, next)
    // While searching, the first matching model is active, not "Automatic"/"No fallback".
    const firstModel = matches.findIndex((option) => option.type === "model")
    setQuery(next)
    setActiveIndex(next.trim() && firstModel !== -1 ? firstModel : 0)
    setOpen(true)
  }

  return (
    <div className="ai-model-combobox">
      <div
        className={classNames("ai-model-combobox__field", {
          "ai-model-combobox__field--open": open,
        })}
      >
        <input
          ref={inputRef}
          aria-activedescendant={active ? optionId(activeIndex) : undefined}
          aria-autocomplete="list"
          aria-controls={listId}
          aria-describedby={details ? detailsId : undefined}
          aria-expanded={open}
          aria-label={label}
          autoComplete="off"
          className="ai-model-combobox__input"
          placeholder={placeholder}
          role="combobox"
          spellCheck={false}
          type="text"
          value={open ? query : (selected?.label ?? "")}
          onBlur={closeList}
          onChange={onQueryChange}
          onKeyDown={onKeyDown}
          onMouseDown={() => !open && openList()}
          onSelect={rememberSelection}
          onFocus={(event) => {
            event.target.select()
            rememberSelection(event)
          }}
        />
        <span
          aria-hidden="true"
          className="ai-model-combobox__chevron"
          onMouseDown={(event) => {
            // Keep focus in the field; the chevron is a pointer shortcut only.
            event.preventDefault()
            inputRef.current?.focus()
            if (open) {
              closeList()
            } else {
              openList()
            }
          }}
        />
      </div>
      <ul
        ref={listRef}
        aria-label={label}
        className="ai-model-combobox__listbox"
        hidden={!open}
        id={listId}
        role="listbox"
        // The list's own scrollbar, padding and border keep focus in the field (pointer only).
        onMouseDown={(event) => event.preventDefault()}
      >
        {open &&
          visible.map((option, index) => (
            <li
              key={`${option.type}:${option.value}`}
              aria-disabled={option.disabled || undefined}
              aria-selected={option.value === value}
              id={optionId(index)}
              role="option"
              className={classNames("ai-model-combobox__option", {
                "ai-model-combobox__option--active": index === activeIndex,
                "ai-model-combobox__option--disabled": option.disabled,
                "ai-model-combobox__option--selected": option.value === value,
              })}
              onClick={() => choose(option)}
              onMouseDown={(event) => event.preventDefault()}
              onMouseMove={() => index !== activeIndex && setActiveIndex(index)}
            >
              <span className="ai-model-option__title">{option.label}</span>
              {option.description && (
                <span className="ai-model-combobox__description">{option.description}</span>
              )}
            </li>
          ))}
      </ul>
      <span className="visually-hidden" id={statusId} role="status">
        {noMatch ? noResults : ""}
      </span>
      {noMatch && (
        <span aria-hidden="true" className="ai-model-combobox__empty">
          {noResults}
        </span>
      )}
      {details && (
        <div className="ai-model-combobox__details" id={detailsId}>
          {details}
        </div>
      )}
    </div>
  )
}

export default ModelCombobox
