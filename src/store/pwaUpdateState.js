import { atom } from "nanostores"

// Transient on purpose: a pending update is never persisted, so a reload starts from a clean state.
// `accept` and `dismiss` are replaced by the update controller when the service worker registers.
const pwaUpdateState = atom({
  available: false,
  accept: () => {},
  dismiss: () => {},
})

export default pwaUpdateState
