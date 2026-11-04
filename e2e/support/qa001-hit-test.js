const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value)

const isDescriptor = (value) =>
  value !== null &&
  typeof value === "object" &&
  typeof value.tagName === "string" &&
  typeof value.role === "string" &&
  typeof value.accessibleName === "string"

const hasValidEvidence = (diagnostics) => {
  if (!diagnostics || typeof diagnostics !== "object") {
    return false
  }

  const { viewport, closeButton, center, hitTarget, nearestInterceptingButton, elementsAtCenter } =
    diagnostics
  return (
    viewport !== null &&
    isFiniteNumber(viewport?.width) &&
    viewport.width > 0 &&
    isFiniteNumber(viewport?.height) &&
    viewport.height > 0 &&
    diagnostics.inputMode === "touch" &&
    closeButton?.accessibleName === "Close article" &&
    [
      closeButton.rect?.x,
      closeButton.rect?.y,
      closeButton.rect?.width,
      closeButton.rect?.height,
    ].every((value) => isFiniteNumber(value)) &&
    closeButton.rect.width > 0 &&
    closeButton.rect.height > 0 &&
    isFiniteNumber(center?.x) &&
    isFiniteNumber(center?.y) &&
    isDescriptor(hitTarget) &&
    typeof diagnostics.hitTargetIsCloseArticle === "boolean" &&
    (nearestInterceptingButton === null || isDescriptor(nearestInterceptingButton)) &&
    Array.isArray(elementsAtCenter) &&
    elementsAtCenter.length > 0 &&
    elementsAtCenter.every(
      (element) => isDescriptor(element) && typeof element.isCloseArticle === "boolean",
    )
  )
}

const serialize = (value) => JSON.stringify(value)

/** Classifies QA-001 only when the observed center hit proves the recorded overlap. */
export const classifyQa001CenterHit = (diagnostics, { knownDefectExpected = false } = {}) => {
  if (!hasValidEvidence(diagnostics)) {
    return {
      state: "FAILED",
      evidence: diagnostics,
      message: `QA-001 missing or invalid hit-test evidence: ${serialize(diagnostics)}`,
    }
  }

  if (diagnostics.hitTargetIsCloseArticle) {
    return knownDefectExpected
      ? {
          state: "FAILED",
          evidence: diagnostics,
          message: `QA-001 known-defect marker for ${diagnostics.viewport.width}x${diagnostics.viewport.height} no longer reproduces; Close article received its center: ${serialize(diagnostics)}`,
        }
      : { state: "PASSED", evidence: diagnostics, message: "Close article received its center" }
  }

  const sidebarInterceptConfirmed =
    diagnostics.nearestInterceptingButton?.role === "button" &&
    diagnostics.nearestInterceptingButton.accessibleName === "Open sidebar" &&
    (() => {
      const sidebarIndex = diagnostics.elementsAtCenter.findIndex(
        (element) => element.role === "button" && element.accessibleName === "Open sidebar",
      )
      const closeIndex = diagnostics.elementsAtCenter.findIndex((element) => element.isCloseArticle)
      return sidebarIndex !== -1 && closeIndex > sidebarIndex
    })()

  if (knownDefectExpected && sidebarInterceptConfirmed) {
    return {
      state: "KNOWN_DEFECT",
      evidence: diagnostics,
      message: `QA-001 demonstrated Open sidebar intercepting Close article at ${diagnostics.viewport.width}x${diagnostics.viewport.height}`,
    }
  }

  return {
    state: "FAILED",
    evidence: diagnostics,
    message: `QA-001 unexpected hit target at ${diagnostics.viewport.width}x${diagnostics.viewport.height}: ${serialize(diagnostics)}`,
  }
}

export const assertQa001CenterHit = (diagnostics, options) => {
  const result = classifyQa001CenterHit(diagnostics, options)
  if (result.state === "FAILED") {
    throw new Error(result.message)
  }
  return result
}
