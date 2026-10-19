/* eslint-disable react-refresh/only-export-components -- Browser harness entrypoint. */
import "@arco-design/web-react/es/_util/react-19-adapter"
import "@arco-design/web-react/dist/css/arco.css"
import Polyglot from "node-polyglot"
import React, { useState } from "react"
import { createRoot } from "react-dom/client"

import AboutModal from "@/components/About/AboutModal"
import { polyglotState } from "@/hooks/useLanguage"
import phrases from "@/locales/en-US.json"
import { PRODUCT_GITHUB_REPO_PATH } from "@/utils/constants"
import buildInfo from "@/version-info.json"

const EXPECTED_BUILD_REVISION = "0123456789abcdef0123456789abcdef01234567"

polyglotState.setKey("polyglot", new Polyglot({ locale: "en-US", phrases }))

const Harness = () => {
  const [visible, setVisible] = useState(true)

  return (
    <>
      <main>
        <h1>About runtime revision browser gate</h1>
        <output data-testid="build-json-revision">{buildInfo.gitFullHash}</output>
      </main>
      <AboutModal visible={visible} onClose={() => setVisible(false)} />
      <div aria-live="polite" data-testid="about-revision-summary" id="about-revision-summary">
        RUNNING
      </div>
    </>
  )
}

const root = createRoot(document.querySelector("#root"))
root.render(<Harness />)

globalThis.setTimeout(() => {
  const revision = document.querySelector(".about-build-list code")
  const sourceLink = document.querySelector(".about-github-button")
  const exactRevisionVisible = revision?.textContent === EXPECTED_BUILD_REVISION.slice(0, 8)
  const fullRevisionAccessible =
    revision?.getAttribute("title") === EXPECTED_BUILD_REVISION &&
    revision?.getAttribute("aria-label")?.includes(EXPECTED_BUILD_REVISION)
  const newsFluxSource =
    sourceLink?.getAttribute("href") === `https://github.com/${PRODUCT_GITHUB_REPO_PATH}`

  const gates = {
    ABOUT_EXACT_BUILD_REVISION:
      buildInfo.gitFullHash === EXPECTED_BUILD_REVISION && exactRevisionVisible ? "PASS" : "FAIL",
    ABOUT_NO_UNKNOWN_WITH_VALID_REVISION:
      buildInfo.gitHash !== "unknown" && exactRevisionVisible ? "PASS" : "FAIL",
    ABOUT_FULL_REVISION_ACCESSIBLE: fullRevisionAccessible ? "PASS" : "FAIL",
    NEWSFLUX_REPOSITORY_IDENTITY: newsFluxSource ? "PASS" : "FAIL",
  }

  for (const [name, result] of Object.entries(gates)) {
    const gate = document.createElement("output")
    gate.dataset.testid = name.toLowerCase().replaceAll("_", "-")
    gate.textContent = `${name}=${result}`
    document.querySelector("#about-revision-summary").append(gate)
  }

  document.querySelector("#about-revision-summary").firstChild.textContent = Object.values(
    gates,
  ).every((result) => result === "PASS")
    ? "PASS"
    : "FAIL"
}, 500)
