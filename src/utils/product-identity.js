/* eslint-disable import/extensions -- Node ESM needs explicit extensions. */
import { PRODUCT_NAME, UPSTREAM_NAME } from "./constants.js"
/* eslint-enable import/extensions */

export const applyRuntimeProductIdentity = (value) => {
  if (typeof value === "string") {
    return value.replaceAll(UPSTREAM_NAME, PRODUCT_NAME)
  }

  if (Array.isArray(value)) {
    return value.map((nestedValue) => applyRuntimeProductIdentity(nestedValue))
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        applyRuntimeProductIdentity(nestedValue),
      ]),
    )
  }

  return value
}
