import { IconInfoCircle } from "@arco-design/web-react/icon"
import { useStore } from "@nanostores/react"
import { useEffect, useRef, useState } from "react"

import HomeHighlightCard from "./HomeHighlightCard"

import { polyglotState } from "@/hooks/useLanguage"

const HIGHLIGHT_SLOTS = ["primary", "secondary-1", "secondary-2"]

const PERSONALIZATION_EXPLANATION_ID = "home-highlights-personalization-explanation"

const HomeHighlights = ({
  articleActivation,
  entries,
  highlightIds,
  observeRead,
  personalizationApplied = false,
}) => {
  const { polyglot } = useStore(polyglotState)
  const [explanationOpen, setExplanationOpen] = useState(false)
  const infoButtonRef = useRef(null)
  // Resolve each ID in place: a vacant slot never promotes a surviving Secondary.
  const entryById = new Map()
  for (const entry of entries) {
    if (!entryById.has(entry.id)) {
      entryById.set(entry.id, entry)
    }
  }
  const seen = new Set()
  const slots = HIGHLIGHT_SLOTS.map((slot, index) => {
    const id = highlightIds[index]
    const entry = id == null || seen.has(id) ? null : entryById.get(id)
    if (!entry) {
      return null
    }
    seen.add(id)
    return (
      <div key={slot} className={`home-highlight-slot home-highlight-slot-${slot}`}>
        <HomeHighlightCard
          articleActivation={articleActivation}
          entry={entry}
          observeRead={observeRead}
          slot={slot}
        />
      </div>
    )
  })

  useEffect(() => {
    if (!explanationOpen) {
      return
    }

    const closeOnEscape = (event) => {
      if (event.key === "Escape") {
        event.preventDefault()
        event.stopPropagation()
        setExplanationOpen(false)
        infoButtonRef.current?.focus()
      }
    }
    globalThis.addEventListener("keydown", closeOnEscape)
    return () => globalThis.removeEventListener("keydown", closeOnEscape)
  }, [explanationOpen])

  if (!slots.some(Boolean)) {
    return null
  }

  return (
    <section aria-label={polyglot.t("home_page.section_highlights")} className="home-highlights">
      <div className="home-highlights-heading-row">
        <h2 className="home-section-heading">{polyglot.t("home_page.section_highlights")}</h2>
        {personalizationApplied && (
          <button
            ref={infoButtonRef}
            aria-controls={PERSONALIZATION_EXPLANATION_ID}
            aria-expanded={explanationOpen}
            aria-label={polyglot.t("home_page.personalization_info_label")}
            className="home-personalization-info-button"
            type="button"
            onClick={() => setExplanationOpen((open) => !open)}
          >
            <IconInfoCircle aria-hidden="true" />
          </button>
        )}
      </div>
      {personalizationApplied && (
        <div
          className="home-personalization-explanation"
          hidden={!explanationOpen}
          id={PERSONALIZATION_EXPLANATION_ID}
        >
          {polyglot.t("home_page.personalization_info")}
        </div>
      )}
      {slots[0]}
      {slots.slice(1).some(Boolean) && (
        <div className="home-highlight-secondaries">{slots.slice(1)}</div>
      )}
    </section>
  )
}

export default HomeHighlights
