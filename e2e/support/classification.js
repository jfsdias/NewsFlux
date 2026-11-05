import { stripVTControlCharacters } from "node:util"

import { test } from "@playwright/test"

/**
 * Scenarios that currently describe a defect or an unapproved requirement must not pass silently
 * and must not be reported as confirmed regressions. These helpers run the scenario body and
 * require it to fail *for the recorded reason*. They then record an annotation that the inventory
 * reporter prints, so the result is "known defect" or "requirement pending", never a plain pass.
 *
 * If the body starts to pass, the helper fails the test: the defect was fixed (or the requirement
 * approved), so the marker and the findings register entry must be updated.
 */

const firstLine = (text) => stripVTControlCharacters(String(text)).split("\n", 1)[0]

export const matchesFailureSignature = (failure, signature) =>
  signature.test(String(failure?.message ?? failure))

const expectRecordedFailure = async ({ type, id, signature }, action) => {
  let failure
  try {
    await action()
  } catch (error) {
    failure = error
  }

  if (failure === undefined) {
    throw new Error(
      `${id} no longer reproduces. Remove its ${type} marker and update docs/qa/FINDINGS_REGISTER.md.`,
    )
  }

  const message = String(failure.message)
  if (!matchesFailureSignature(failure, signature)) {
    throw new Error(
      `${id}: the scenario failed, but not for the recorded reason (${signature}). Actual: ${firstLine(message)}`,
    )
  }

  test.info().annotations.push({ type, description: `${id}: ${firstLine(message)}` })
}

/** A behavior with no approved requirement. The scenario asserts the PROPOSED behavior. */
export const requirementPending = (id, signature, action) =>
  expectRecordedFailure({ type: "requirement-pending", id, signature }, action)
