import { Button } from "@arco-design/web-react"
import { IconGithub } from "@arco-design/web-react/icon"
import { useStore } from "@nanostores/react"

import AccessibleModal from "@/components/ui/AccessibleModal"
import { polyglotState } from "@/hooks/useLanguage"
import {
  PRODUCT_GITHUB_REPO_PATH,
  PRODUCT_NAME,
  UPSTREAM_GITHUB_REPO_PATH,
  UPSTREAM_NAME,
} from "@/utils/constants"
import { formatLocalizedDate } from "@/utils/date"
import buildInfo from "@/version-info.json"
import "./AboutModal.css"

const REPOSITORY_URL = `https://github.com/${PRODUCT_GITHUB_REPO_PATH}`
const UPSTREAM_REPOSITORY_URL = `https://github.com/${UPSTREAM_GITHUB_REPO_PATH}`
const LOGO_URL = `${import.meta.env.BASE_URL}logo192.png`

const AboutModal = ({ visible, onClose }) => {
  const { polyglot } = useStore(polyglotState)
  const title = polyglot.t("about.title")
  const unknownLabel = polyglot.t("about.unknown")
  const commitHash = buildInfo.gitHash === "unknown" ? unknownLabel : buildInfo.gitHash

  return (
    <AccessibleModal
      alignCenter
      unmountOnExit
      className="about-modal"
      closeLabel={polyglot.t("actions.close_dialog", { name: title })}
      dialogLabel={title}
      fallbackFocusSelector=".sidebar-profile-trigger"
      footer={null}
      title={title}
      visible={visible}
      onCancel={onClose}
    >
      <div className="about-modal-content">
        <header className="about-brand">
          <img
            alt=""
            className="about-logo"
            decoding="async"
            height="80"
            src={LOGO_URL}
            width="80"
          />
          <p className="about-product-name">{PRODUCT_NAME}</p>
          <p className="about-description">{polyglot.t("about.description")}</p>
          <p className="about-upstream-credit">
            Based on{" "}
            <a href={UPSTREAM_REPOSITORY_URL} rel="noopener noreferrer" target="_blank">
              {UPSTREAM_NAME}
            </a>
          </p>
        </header>

        <section aria-labelledby="about-build-title" className="about-build">
          <h2 className="about-build-title" id="about-build-title">
            {polyglot.t("about.build_information")}
          </h2>
          <dl className="about-build-list">
            <div className="about-build-row">
              <dt>{polyglot.t("about.commit")}</dt>
              <dd>
                <code>{commitHash}</code>
              </dd>
            </div>
            <div className="about-build-row">
              <dt>{polyglot.t("about.build_date")}</dt>
              <dd>
                {buildInfo.gitDate ? (
                  <time dateTime={buildInfo.gitDate}>{formatLocalizedDate(buildInfo.gitDate)}</time>
                ) : (
                  unknownLabel
                )}
              </dd>
            </div>
          </dl>
        </section>

        <Button
          long
          aria-label={polyglot.t("about.github_link_label")}
          className="about-github-button"
          href={REPOSITORY_URL}
          icon={<IconGithub aria-hidden="true" />}
          rel="noopener noreferrer"
          target="_blank"
          type="primary"
        >
          {polyglot.t("about.view_on_github")}
        </Button>
      </div>
    </AccessibleModal>
  )
}

export default AboutModal
