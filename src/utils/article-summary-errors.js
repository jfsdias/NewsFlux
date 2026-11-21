// Maps Summary API error codes to a message the reader can act on. The code itself is
// shown next to the message so a failure can be diagnosed without browser dev tools.
const MESSAGE_BY_CODE = {
  NOT_AUTHORIZED: "error_session",
  HOST_NOT_AUTHORIZED: "error_session",
  HTTPS_REQUIRED: "error_session",
  UNAUTHENTICATED: "error_session",
  SUMMARY_BUSY: "error_busy",
  STALE_SNAPSHOT: "error_stale",
  MODEL_OUTPUT_INVALID: "error_model_output",
  ENTRY_NOT_ACCESSIBLE: "error_entry",
  MINIFLUX_UNAVAILABLE: "error_miniflux",
  REQUEST_TOO_LARGE: "error_request",
  INVALID_REQUEST: "error_request",
  INVALID_JSON: "error_request",
  INVALID_RESPONSE: "error_request",
  NETWORK: "error_network",
}

const summaryErrorMessageKey = (code) => `article_intelligence.${MESSAGE_BY_CODE[code] ?? "error"}`

export default summaryErrorMessageKey
