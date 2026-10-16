const READER_TRANSIENT_SELECTOR = ".article-content .arco-dropdown-popup-visible"

const shouldDeferReaderEscape = (event, documentRef = globalThis.document) =>
  Boolean(event?.defaultPrevented || documentRef?.querySelector(READER_TRANSIENT_SELECTOR))

export default shouldDeferReaderEscape
