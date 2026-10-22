import { Button, Form, Input, Message, Radio, Select, Switch } from "@arco-design/web-react"
import { useStore } from "@nanostores/react"
import { Fragment, useEffect, useRef, useState } from "react"
import { Outlet, useLocation, useNavigate } from "react-router"

import { addFeed, discoverFeeds } from "@/apis"
import { ContextProvider } from "@/components/Content/ContentContext"
import SettingsModalContent from "@/components/Settings/SettingsModalContent"
import AccessibleModal from "@/components/ui/AccessibleModal"
import useAppData from "@/hooks/useAppData"
import { polyglotState } from "@/hooks/useLanguage"
import useModalToggle from "@/hooks/useModalToggle"
import useScreenWidth from "@/hooks/useScreenWidth"
import { catalogCategoriesState, catalogFeedsState } from "@/store/dataState"
import { discoverAndSubscribeFeed } from "@/utils/feed-discovery"
import includesIgnoreCase from "@/utils/filter"
import { DEFAULT_SETTINGS_TAB } from "@/utils/settings-navigation"
import "./Main.css"

const urlRule = [{ required: true }]
const categoryRule = [{ required: true }]
const crawlerRule = [{ type: "boolean" }]

// Lowercased, scheme-less and slash-less so "Example.com/feed/" and "https://example.com/feed"
// read as the same text.
const normalizeDiscoveryText = (value) =>
  value
    .replaceAll(/\s+/g, " ")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "")
    .toLowerCase()

// A candidate's URL is shown exactly once: as the primary line when the title is missing or only
// repeats the URL, and as the secondary line when the title adds information.
const getDiscoveryCandidateLabels = ({ title, url }) => {
  const label = typeof title === "string" ? title.replaceAll(/\s+/g, " ").trim() : ""
  if (!label || normalizeDiscoveryText(label) === normalizeDiscoveryText(url)) {
    return { primary: url, secondary: null }
  }
  return { primary: label, secondary: url }
}

// <wbr> after path punctuation lets a long URL wrap at segment boundaries instead of mid-word.
const UrlText = ({ value }) =>
  (value.match(/[^/?&=#]+[/?&=#]*|[/?&=#]+/g) ?? []).map((part, index) => (
    <Fragment key={`${index}:${part}`}>
      {index > 0 && <wbr />}
      {part}
    </Fragment>
  ))

const DiscoveryCandidateLabel = ({ candidate }) => {
  const { primary, secondary } = getDiscoveryCandidateLabels(candidate)

  return (
    <>
      <span className="add-feed-discovery-candidate-title">
        {secondary === null ? <UrlText value={primary} /> : primary}
      </span>
      {secondary !== null && (
        <span className="add-feed-discovery-candidate-url">
          <UrlText value={secondary} />
        </span>
      )}
    </>
  )
}

const SettingsModal = () => {
  const location = useLocation()
  const { polyglot } = useStore(polyglotState)

  const { isBelowMedium } = useScreenWidth()
  const {
    setSettingsModalVisible,
    setSettingsTabsActiveTab,
    settingsModalVisible,
    settingsTabsActiveTab,
  } = useModalToggle()
  const previousPathnameRef = useRef(location.pathname)

  useEffect(() => {
    const hasPathnameChanged = previousPathnameRef.current !== location.pathname
    previousPathnameRef.current = location.pathname

    if (hasPathnameChanged && isBelowMedium && settingsModalVisible) {
      setSettingsModalVisible(false)
      setSettingsTabsActiveTab(DEFAULT_SETTINGS_TAB)
    }
  }, [
    isBelowMedium,
    location.pathname,
    setSettingsModalVisible,
    setSettingsTabsActiveTab,
    settingsModalVisible,
  ])

  const settingsTitle = polyglot.t("sidebar.settings")

  const handleClose = () => {
    setSettingsModalVisible(false)
    setSettingsTabsActiveTab(DEFAULT_SETTINGS_TAB)
  }

  return (
    <AccessibleModal
      unmountOnExit
      alignCenter={false}
      className="settings-modal"
      closeLabel={polyglot.t("actions.close_dialog", { name: settingsTitle })}
      dialogLabel={settingsTitle}
      fallbackFocusSelector=".sidebar-profile-trigger"
      footer={null}
      title={null}
      visible={settingsModalVisible}
      wrapClassName="settings-modal-wrapper"
      onCancel={handleClose}
    >
      <SettingsModalContent
        activeTab={settingsTabsActiveTab}
        onClose={handleClose}
        onTabChange={setSettingsTabsActiveTab}
      />
    </AccessibleModal>
  )
}

const AddFeedModal = () => {
  const { polyglot } = useStore(polyglotState)
  const categories = useStore(catalogCategoriesState)
  const feeds = useStore(catalogFeedsState)
  const { isBelowMedium } = useScreenWidth()

  const [feedModalLoading, setFeedModalLoading] = useState(false)
  const [discoveryLoading, setDiscoveryLoading] = useState(false)
  const [discoveryPrompt, setDiscoveryPrompt] = useState(null)
  const [selectedDiscoveryUrl, setSelectedDiscoveryUrl] = useState("")
  const [feedForm] = Form.useForm()
  const feedUrlInputRef = useRef(null)
  const discoveryTriggerRef = useRef(null)
  const discoveryResolverRef = useRef(null)
  const discoveryRequestIdRef = useRef(0)

  const { refreshFeedData } = useAppData()
  const { addFeedModalVisible, setAddFeedModalVisible } = useModalToggle()

  const navigate = useNavigate()
  const modalTitle = polyglot.t("main.add_feed_modal_title")

  const handleAfterOpen = () => feedUrlInputRef.current?.focus()
  const handleDiscoveryPromptAfterClose = () => {
    setDiscoveryPrompt(null)
    setSelectedDiscoveryUrl("")
  }

  const handleAddFeed = async (url, categoryId, isFullText) => {
    setFeedModalLoading(true)
    const id = "add-feed-loading"

    try {
      if (feeds.some((feed) => feed.feed_url === url)) {
        Message.error(polyglot.t("main.add_feed_error_duplicate"))
        return false
      }

      const response = await addFeed(url, categoryId, isFullText)
      Message.loading({ id, duration: 0, content: polyglot.t("main.add_feed_loading") })

      await refreshFeedData({ force: true }).catch((error) => {
        console.error("Failed to refresh data after adding a feed:", error)
      })
      Message.success({ id, content: polyglot.t("main.add_feed_success") })
      setAddFeedModalVisible(false)
      navigate(`/feed/${response.feed_id}`)
      feedForm.resetFields()
      return true
    } catch (error) {
      console.error("Failed to add a feed:", error)
      Message.error({ id, content: polyglot.t("main.add_feed_error") })
      return false
    } finally {
      setFeedModalLoading(false)
    }
  }

  const resolveDiscoveryCandidate = (candidates) =>
    new Promise((resolve) => {
      discoveryResolverRef.current = resolve
      setSelectedDiscoveryUrl(candidates.length === 1 ? candidates[0].url : "")
      setDiscoveryPrompt({
        candidates,
        mode: candidates.length === 1 ? "confirm" : "choose",
        visible: true,
      })
    })

  const finishDiscoveryPrompt = (candidate = null) => {
    const resolve = discoveryResolverRef.current
    discoveryResolverRef.current = null
    setDiscoveryPrompt((current) => (current ? { ...current, visible: false } : current))
    resolve?.(candidate)
  }

  const handleDiscoverFromWebsite = async () => {
    let values
    try {
      values = await feedForm.validate()
    } catch {
      return
    }

    const url = values.url?.trim()
    if (!url) {
      Message.error(polyglot.t("main.add_feed_url_empty"))
      return
    }

    discoveryTriggerRef.current?.focus({ preventScroll: true })
    const requestId = ++discoveryRequestIdRef.current
    setDiscoveryLoading(true)
    try {
      const result = await discoverAndSubscribeFeed({
        url,
        categoryId: values.category,
        isFullText: Boolean(values.crawler),
        discover: async (websiteUrl) => {
          const candidates = await discoverFeeds(websiteUrl)
          return requestId === discoveryRequestIdRef.current ? candidates : []
        },
        resolveCandidate: (candidates) => {
          if (requestId !== discoveryRequestIdRef.current) {
            return null
          }
          discoveryTriggerRef.current?.focus({ preventScroll: true })
          return resolveDiscoveryCandidate(candidates)
        },
        subscribe: handleAddFeed,
      })

      if (requestId === discoveryRequestIdRef.current && result.status === "empty") {
        Message.error(polyglot.t("main.add_feed_discover_no_results"))
      }
    } catch (error) {
      if (requestId === discoveryRequestIdRef.current) {
        console.error("Failed to discover feeds:", error)
        Message.error(polyglot.t("main.add_feed_discover_error"))
      }
    } finally {
      if (requestId === discoveryRequestIdRef.current) {
        setDiscoveryLoading(false)
      }
    }
  }

  const handleConfirmDiscoveredFeed = () => {
    const candidate = discoveryPrompt?.candidates.find(({ url }) => url === selectedDiscoveryUrl)
    if (candidate) {
      finishDiscoveryPrompt(candidate)
    }
  }

  const cancelAddFeed = () => {
    discoveryRequestIdRef.current += 1
    setDiscoveryLoading(false)
    finishDiscoveryPrompt(null)
    setAddFeedModalVisible(false)
    feedForm.resetFields()
  }

  const discoveryTitle = polyglot.t(
    discoveryPrompt?.mode === "confirm"
      ? "main.add_feed_discover_single_title"
      : "main.add_feed_discover_multiple_title",
  )

  return (
    <>
      <AccessibleModal
        unmountOnExit
        afterOpen={handleAfterOpen}
        className="add-feed-modal"
        closeLabel={polyglot.t("actions.close_dialog", { name: modalTitle })}
        confirmLoading={feedModalLoading}
        okButtonProps={{ disabled: discoveryLoading || feedModalLoading }}
        title={modalTitle}
        visible={addFeedModalVisible}
        onCancel={cancelAddFeed}
        onOk={feedForm.submit}
      >
        <Form
          form={feedForm}
          labelCol={{ span: 7 }}
          layout="vertical"
          wrapperCol={{ span: 17 }}
          onSubmit={async (values) => {
            const url = values.url.trim()
            if (url) {
              await handleAddFeed(url, values.category, values.crawler)
            } else {
              Message.error(polyglot.t("main.add_feed_url_empty"))
            }
          }}
        >
          <Form.Item label={polyglot.t("main.add_feed_modal_feed_url_label")}>
            <Form.Item noStyle field="url" rules={urlRule}>
              <Input
                ref={feedUrlInputRef}
                autoCapitalize="none"
                autoCorrect="off"
                inputMode="url"
                placeholder={polyglot.t("main.add_feed_modal_feed_url_placeholder")}
                spellCheck={false}
              />
            </Form.Item>
            <Button
              ref={discoveryTriggerRef}
              className="add-feed-discover-trigger"
              disabled={feedModalLoading}
              loading={discoveryLoading}
              type="secondary"
              onClick={handleDiscoverFromWebsite}
            >
              {polyglot.t("main.add_feed_discover_button")}
            </Button>
          </Form.Item>
          <Form.Item
            required
            field="category"
            label={polyglot.t("main.add_feed_modal_category_label")}
            rules={categoryRule}
          >
            <Select
              showSearch
              getPopupContainer={isBelowMedium ? () => document.body : undefined}
              placeholder={polyglot.t("main.add_feed_modal_category_placeholder")}
              filterOption={(inputValue, option) =>
                includesIgnoreCase(option.props.children, inputValue)
              }
              triggerProps={{
                boundaryDistance: { bottom: 8, left: 8, right: 8, top: 8 },
                className: "add-feed-category-select-popup",
              }}
            >
              {categories.map((category) => (
                <Select.Option key={category.id} value={category.id}>
                  {category.title}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item
            field="crawler"
            initialValue={false}
            label={polyglot.t("main.add_feed_modal_crawler_label")}
            rules={crawlerRule}
            style={{ marginBottom: 0 }}
            triggerPropName="checked"
          >
            <Switch className="add-feed-switch" />
          </Form.Item>
        </Form>
      </AccessibleModal>
      <AccessibleModal
        afterClose={handleDiscoveryPromptAfterClose}
        className="add-feed-discovery-modal"
        closeLabel={polyglot.t("actions.close_dialog", { name: discoveryTitle })}
        dialogLabel={discoveryTitle}
        fallbackFocusSelector=".add-feed-discover-trigger"
        maskStyle={{ zIndex: 1010 }}
        title={discoveryTitle}
        visible={Boolean(discoveryPrompt?.visible)}
        wrapStyle={{ zIndex: 1011 }}
        footer={
          <>
            <Button onClick={() => finishDiscoveryPrompt(null)}>
              {polyglot.t("main.add_feed_discover_cancel")}
            </Button>
            <Button
              disabled={!selectedDiscoveryUrl || feedModalLoading}
              type="primary"
              onClick={handleConfirmDiscoveredFeed}
            >
              {polyglot.t("main.add_feed_discover_subscribe")}
            </Button>
          </>
        }
        onCancel={() => finishDiscoveryPrompt(null)}
      >
        {discoveryPrompt?.mode === "confirm" ? (
          <>
            <p>{polyglot.t("main.add_feed_discover_single_description")}</p>
            <div className="add-feed-discovery-candidates">
              {discoveryPrompt.candidates.map((candidate) => (
                <div key={candidate.url} className="add-feed-discovery-candidate">
                  <DiscoveryCandidateLabel candidate={candidate} />
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <p>{polyglot.t("main.add_feed_discover_multiple_description")}</p>
            <Radio.Group
              aria-label={discoveryTitle}
              className="add-feed-discovery-candidates"
              direction="vertical"
              value={selectedDiscoveryUrl}
              onChange={setSelectedDiscoveryUrl}
            >
              {discoveryPrompt?.candidates.map((candidate) => (
                <Radio
                  key={candidate.url}
                  className="add-feed-discovery-candidate"
                  value={candidate.url}
                >
                  <DiscoveryCandidateLabel candidate={candidate} />
                </Radio>
              ))}
            </Radio.Group>
          </>
        )}
      </AccessibleModal>
    </>
  )
}

const Main = () => (
  <main className="main" id="main-content" tabIndex={-1}>
    <ContextProvider>
      <Outlet />
    </ContextProvider>
    <SettingsModal />
    <AddFeedModal />
  </main>
)

export default Main
