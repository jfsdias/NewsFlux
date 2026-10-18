import {
  Form,
  Input,
  Link,
  Message,
  Modal,
  Notification,
  Select,
  Switch,
} from "@arco-design/web-react"
import { useStore } from "@nanostores/react"
import { useEffect, useRef, useState } from "react"

import AccessibleModal from "./AccessibleModal"

import { getFeed, getFeeds, updateFeed } from "@/apis"
import { polyglotState } from "@/hooks/useLanguage"
import useRefreshCounts from "@/hooks/useRefreshCounts"
import { authState } from "@/store/authState"
import { invalidateArticleList } from "@/store/contentState"
import { catalogCategoriesState, getDataSessionRevision, setFeedsData } from "@/store/dataState"
import { confirmDialogProps } from "@/utils/confirm-dialog"
import "./EditFeedModal.css"

const FORM_FIELDS = [
  "categoryId",
  "title",
  "siteUrl",
  "feedUrl",
  "hidden",
  "disabled",
  "crawler",
  "blocklistRules",
  "keeplistRules",
]

const RULE_FIELD_TO_PROVIDER = {
  blocklistRules: "blocklist_rules",
  keeplistRules: "keeplist_rules",
}

const getFeedFormValues = (feed) => ({
  categoryId: feed.category?.id,
  title: feed.title ?? "",
  siteUrl: feed.site_url ?? "",
  feedUrl: feed.feed_url ?? "",
  hidden: Boolean(feed.hidden ?? feed.hide_globally),
  disabled: Boolean(feed.disabled),
  crawler: Boolean(feed.crawler),
  blocklistRules: feed.blocklist_rules ?? "",
  keeplistRules: feed.keeplist_rules ?? "",
})

const getMergedFormValues = (form, initialValues) => ({
  ...initialValues,
  ...form.getFieldsValue(),
})

const getChangedFields = (values, initialValues, fields) =>
  fields.filter((field) => !Object.is(values[field], initialValues?.[field]))

const isProviderFeed = (feed, feedId) =>
  Boolean(feed && typeof feed === "object" && Number(feed.id) === Number(feedId))

const hasProviderRuleValues = (feed) =>
  typeof feed?.blocklist_rules === "string" && typeof feed?.keeplist_rules === "string"

const matchesRequestedFeed = (providerFeed, newDetails, changedRuleFields) => {
  const expectedFields = {
    title: newDetails.title,
    site_url: newDetails.siteUrl,
    feed_url: newDetails.feedUrl,
    hide_globally: newDetails.hidden,
    disabled: newDetails.disabled,
    crawler: newDetails.isFullText,
  }

  if (
    Object.entries(expectedFields).some(([field, value]) => !Object.is(providerFeed[field], value))
  ) {
    return false
  }

  if (
    newDetails.categoryId !== undefined &&
    !Object.is(Number(providerFeed.category?.id), Number(newDetails.categoryId))
  ) {
    return false
  }

  return changedRuleFields.every((field) =>
    Object.is(providerFeed[RULE_FIELD_TO_PROVIDER[field]], newDetails[field]),
  )
}

const EditFeedModal = ({
  visible,
  setVisible,
  feedForm,
  fallbackFocusSelector,
  selectedFeed,
  onSuccess,
  useNotification = false,
}) => {
  const { polyglot } = useStore(polyglotState)
  const refreshCounts = useRefreshCounts()
  const auth = useStore(authState)
  const categories = useStore(catalogCategoriesState)
  const [draftValues, setDraftValues] = useState(null)
  const [providerBaseline, setProviderBaseline] = useState(null)
  const [saveError, setSaveError] = useState("")
  const [saving, setSaving] = useState(false)
  const initialValuesRef = useRef(null)
  const savingRef = useRef(false)

  const feedId = selectedFeed?.id || selectedFeed?.key
  const minifluxEditUrl = `${auth.server}/feed/${feedId}/edit`
  const modalTitle = polyglot.t("feed_table.modal_edit_feed_title")
  const initialValues = providerBaseline ?? (selectedFeed ? getFeedFormValues(selectedFeed) : {})
  const currentValues = draftValues ?? initialValues
  const dirtyRuleFields = getChangedFields(currentValues, initialValues, [
    "blocklistRules",
    "keeplistRules",
  ])
  const hasDirtyRules = dirtyRuleFields.length > 0
  const hasBlockRule =
    typeof currentValues.blocklistRules === "string" && currentValues.blocklistRules.length > 0
  const hasKeepRule =
    typeof currentValues.keeplistRules === "string" && currentValues.keeplistRules.length > 0
  const initialFeedHasError = Number(selectedFeed?.parsing_error_count ?? 0) > 0

  useEffect(() => {
    if (!visible || !selectedFeed) {
      return
    }

    const initialValues = getFeedFormValues(selectedFeed)
    initialValuesRef.current = initialValues
    feedForm.setFieldsValue(initialValues)
  }, [feedForm, feedId, selectedFeed, visible])

  const isFormDirty = () => {
    const initialValues = initialValuesRef.current
    if (!initialValues) {
      return false
    }
    return (
      getChangedFields(getMergedFormValues(feedForm, initialValues), initialValues, FORM_FIELDS)
        .length > 0
    )
  }

  const closeAndDiscardDraft = () => {
    setVisible(false)
    feedForm.resetFields()
    initialValuesRef.current = null
    setDraftValues(null)
    setProviderBaseline(null)
    setSaveError("")
  }

  const handleCancel = () => {
    if (savingRef.current) {
      return
    }
    if (!isFormDirty()) {
      closeAndDiscardDraft()
      return
    }

    Modal.confirm({
      ...confirmDialogProps,
      title: polyglot.t("feed_table.filter_rules_discard_title"),
      content: polyglot.t("feed_table.filter_rules_discard_description"),
      okText: polyglot.t("feed_table.filter_rules_discard_action"),
      cancelText: polyglot.t("feed_table.filter_rules_keep_editing_action"),
      onOk: closeAndDiscardDraft,
    })
  }

  const updateLocalProviderFeed = (providerFeed) => {
    setFeedsData((feeds) =>
      feeds.map((feed) => (Number(feed.id) === Number(feedId) ? providerFeed : feed)),
    )
  }

  const reflectProviderFeedInForm = (providerFeed) => {
    const providerValues = getFeedFormValues(providerFeed)
    initialValuesRef.current = providerValues
    feedForm.setFieldsValue(providerValues)
    setProviderBaseline(providerValues)
    setDraftValues(providerValues)
  }

  const notifySuccess = (message) => {
    if (useNotification) {
      Notification.success({ title: message })
    } else {
      Message.success(message)
    }
  }

  const closeAfterSave = () => {
    setVisible(false)
    feedForm.resetFields()
    initialValuesRef.current = null
    setDraftValues(null)
    setProviderBaseline(null)
    setSaveError("")
  }

  const finishProviderUpdate = async ({
    providerFeed,
    rulesChanged,
    visibilityChanged,
    sessionRevision,
  }) => {
    if (sessionRevision !== getDataSessionRevision()) {
      return
    }

    updateLocalProviderFeed(providerFeed)
    if (visibilityChanged) {
      invalidateArticleList()
      await refreshCounts({ force: true })
      if (sessionRevision !== getDataSessionRevision()) {
        return
      }
    }

    const message = rulesChanged
      ? polyglot.t("feed_table.filter_rules_saved")
      : polyglot.t("feed_table.update_feed_success")
    notifySuccess(message)
    closeAfterSave()
    onSuccess?.(providerFeed)
  }

  const reconcileMissingFeed = async (sessionRevision) => {
    try {
      const providerFeeds = await getFeeds()
      if (sessionRevision !== getDataSessionRevision()) {
        return
      }
      if (Array.isArray(providerFeeds)) {
        setFeedsData(providerFeeds)
      }
    } catch (error) {
      if (sessionRevision !== getDataSessionRevision()) {
        return
      }
      console.error("Failed to reconcile missing feed:", error)
    }
    if (sessionRevision === getDataSessionRevision()) {
      setSaveError(polyglot.t("feed_table.filter_rules_feed_disappeared"))
    }
  }

  const reflectMismatch = (providerFeed, sessionRevision) => {
    if (sessionRevision !== getDataSessionRevision()) {
      return
    }
    updateLocalProviderFeed(providerFeed)
    reflectProviderFeedInForm(providerFeed)
    setSaveError(polyglot.t("feed_table.filter_rules_provider_mismatch"))
  }

  const handleAmbiguousFailure = async ({
    error,
    newDetails,
    changedRuleFields,
    visibilityChanged,
    sessionRevision,
  }) => {
    if (error.status === 404) {
      await reconcileMissingFeed(sessionRevision)
      return
    }

    if (error.status && error.status < 500) {
      if (sessionRevision === getDataSessionRevision()) {
        setSaveError(polyglot.t("feed_table.filter_rules_save_error"))
      }
      return
    }

    try {
      const providerFeed = await getFeed(feedId)
      if (sessionRevision !== getDataSessionRevision()) {
        return
      }
      if (!isProviderFeed(providerFeed, feedId) || !hasProviderRuleValues(providerFeed)) {
        setSaveError(polyglot.t("feed_table.filter_rules_save_unconfirmed"))
        return
      }

      if (matchesRequestedFeed(providerFeed, newDetails, changedRuleFields)) {
        await finishProviderUpdate({
          providerFeed,
          rulesChanged: changedRuleFields.length > 0,
          visibilityChanged,
          sessionRevision,
        })
        return
      }

      reflectMismatch(providerFeed, sessionRevision)
    } catch (readError) {
      if (sessionRevision !== getDataSessionRevision()) {
        return
      }
      if (readError.status === 404) {
        await reconcileMissingFeed(sessionRevision)
        return
      }
      setSaveError(polyglot.t("feed_table.filter_rules_save_unconfirmed"))
    }
  }

  const editFeed = async (newDetails, changedRuleFields) => {
    const sessionRevision = getDataSessionRevision()
    const nextCategory = categories.find(
      (category) => category.id === Number(newDetails.categoryId),
    )
    const wasGloballyHidden = Boolean(
      (selectedFeed.hide_globally ?? selectedFeed.hidden) || selectedFeed.category?.hide_globally,
    )
    const willBeGloballyHidden = Boolean(newDetails.hidden || nextCategory?.hide_globally)
    const visibilityChanged = wasGloballyHidden !== willBeGloballyHidden

    savingRef.current = true
    setSaving(true)
    setSaveError("")

    try {
      let providerFeed = await updateFeed(feedId, newDetails)
      if (sessionRevision !== getDataSessionRevision()) {
        return
      }

      if (
        !isProviderFeed(providerFeed, feedId) ||
        (changedRuleFields.length > 0 && !hasProviderRuleValues(providerFeed))
      ) {
        providerFeed = await getFeed(feedId)
        if (sessionRevision !== getDataSessionRevision()) {
          return
        }
      }

      if (!isProviderFeed(providerFeed, feedId) || !hasProviderRuleValues(providerFeed)) {
        setSaveError(polyglot.t("feed_table.filter_rules_save_unconfirmed"))
        return
      }

      const responseMismatch = changedRuleFields.some(
        (field) => !Object.is(providerFeed[RULE_FIELD_TO_PROVIDER[field]], newDetails[field]),
      )
      if (responseMismatch) {
        reflectMismatch(providerFeed, sessionRevision)
        return
      }

      await finishProviderUpdate({
        providerFeed,
        newDetails,
        rulesChanged: changedRuleFields.length > 0,
        visibilityChanged,
        sessionRevision,
      })
    } catch (error) {
      if (sessionRevision !== getDataSessionRevision()) {
        return
      }

      if (error.status === 404) {
        await reconcileMissingFeed(sessionRevision)
        return
      }

      if (error.status === 400 || error.status === 422) {
        setSaveError(polyglot.t("feed_table.filter_rules_save_error"))
        return
      }

      if (changedRuleFields.length > 0) {
        await handleAmbiguousFailure({
          error,
          newDetails,
          changedRuleFields,
          visibilityChanged,
          sessionRevision,
        })
        return
      }

      console.error("Failed to update feed:", error)
      const errorMessage = polyglot.t("feed_table.update_feed_error")
      if (useNotification) {
        Notification.error({ title: errorMessage })
      } else {
        Message.error(errorMessage)
      }
    } finally {
      savingRef.current = false
      if (sessionRevision === getDataSessionRevision()) {
        setSaving(false)
      }
    }
  }

  const handleValuesChange = (_changedValues, values) => {
    const initialValues = initialValuesRef.current ?? {}
    setDraftValues({ ...initialValues, ...values })
    setSaveError("")
  }

  const handleSubmit = async (values) => {
    const initialValues = initialValuesRef.current ?? {}
    const changedRuleFields = getChangedFields(values, initialValues, [
      "blocklistRules",
      "keeplistRules",
    ])
    const newDetails = {
      categoryId: values.categoryId,
      title: values.title,
      siteUrl: values.siteUrl?.trim(),
      feedUrl: values.feedUrl?.trim(),
      hidden: values.hidden,
      disabled: values.disabled,
      isFullText: values.crawler,
      ...(changedRuleFields.includes("blocklistRules") && {
        blocklistRules: values.blocklistRules,
      }),
      ...(changedRuleFields.includes("keeplistRules") && {
        keeplistRules: values.keeplistRules,
      }),
    }

    if (!newDetails.feedUrl) {
      const errorMessage = polyglot.t("feed_table.modal_edit_feed_submit_error")
      if (useNotification) {
        Notification.error({ title: errorMessage })
      } else {
        Message.error(errorMessage)
      }
      return
    }

    await editFeed(newDetails, changedRuleFields)
  }

  if (!selectedFeed) {
    return null
  }

  const modalCloseLabel = polyglot.t("actions.close_dialog", { name: modalTitle })
  const blocklistHelperId = "feed-blocklist-rules-help"
  const keeplistHelperId = "feed-keeplist-rules-help"

  return (
    <AccessibleModal
      unmountOnExit
      className="edit-modal"
      closeLabel={modalCloseLabel}
      confirmLoading={saving}
      dialogLabel={modalTitle}
      fallbackFocusSelector={fallbackFocusSelector}
      okButtonProps={{ disabled: saving }}
      title={modalTitle}
      visible={visible}
      onCancel={handleCancel}
      onOk={feedForm.submit}
    >
      <Form
        form={feedForm}
        labelCol={{ span: 7 }}
        layout="vertical"
        wrapperCol={{ span: 17 }}
        onSubmit={handleSubmit}
        onValuesChange={handleValuesChange}
      >
        <Form.Item
          required
          field="categoryId"
          label={polyglot.t("feed_table.modal_edit_feed_category_label")}
          rules={[{ required: true }]}
        >
          <Select>
            {categories.map((category) => (
              <Select.Option key={category.id} value={category.id}>
                {category.title}
              </Select.Option>
            ))}
          </Select>
        </Form.Item>

        <Form.Item
          field="title"
          label={polyglot.t("feed_table.modal_edit_feed_title_label")}
          rules={[{ required: true }]}
        >
          <Input placeholder={polyglot.t("feed_table.modal_edit_feed_title_placeholder")} />
        </Form.Item>

        <Form.Item
          field="siteUrl"
          label={polyglot.t("feed_table.modal_edit_feed_site_url_label")}
          rules={[{ required: true }]}
        >
          <Input placeholder={polyglot.t("feed_table.modal_edit_feed_site_url_placeholder")} />
        </Form.Item>

        <Form.Item
          field="feedUrl"
          label={polyglot.t("feed_table.modal_edit_feed_feed_url_label")}
          rules={[{ required: true }]}
        >
          <Input placeholder={polyglot.t("feed_table.modal_edit_feed_feed_url_placeholder")} />
        </Form.Item>

        <Form.Item
          field="hidden"
          initialValue={selectedFeed.hidden || selectedFeed.hide_globally}
          label={polyglot.t("feed_table.modal_edit_feed_hidden_label")}
          rules={[{ type: "boolean" }]}
          triggerPropName="checked"
        >
          <Switch />
        </Form.Item>

        <Form.Item
          field="disabled"
          initialValue={selectedFeed.disabled}
          label={polyglot.t("feed_table.modal_edit_feed_disabled_label")}
          rules={[{ type: "boolean" }]}
          triggerPropName="checked"
        >
          <Switch />
        </Form.Item>

        <Form.Item
          field="crawler"
          label={polyglot.t("feed_table.modal_edit_feed_crawler_label")}
          rules={[{ type: "boolean" }]}
          tooltip={<div>{polyglot.t("feed_table.modal_edit_feed_crawler_tooltip")}</div>}
          triggerPropName="checked"
        >
          <Switch />
        </Form.Item>

        <section aria-labelledby="feed-article-filters-title" className="feed-article-filters">
          <h3 id="feed-article-filters-title">
            {polyglot.t("feed_table.filter_rules_section_title")}
          </h3>
          <p className="filter-rules-hint">{polyglot.t("feed_table.filter_rules_helper")}</p>
          <Form.Item
            field="blocklistRules"
            label={polyglot.t("feed_table.filter_rules_block_label")}
            extra={
              <span className="filter-rules-field-help" id={blocklistHelperId}>
                {polyglot.t("feed_table.filter_rules_block_help")}
              </span>
            }
          >
            <Input.TextArea
              aria-describedby={blocklistHelperId}
              autoSize={{ minRows: 3, maxRows: 6 }}
              className="filter-rules-textarea"
              data-testid="blocklist-rules-input"
              spellCheck={false}
            />
          </Form.Item>
          <Form.Item
            field="keeplistRules"
            label={polyglot.t("feed_table.filter_rules_keep_label")}
            extra={
              <span className="filter-rules-field-help" id={keeplistHelperId}>
                {polyglot.t("feed_table.filter_rules_keep_help")}
              </span>
            }
          >
            <Input.TextArea
              aria-describedby={keeplistHelperId}
              autoSize={{ minRows: 3, maxRows: 6 }}
              className="filter-rules-textarea"
              data-testid="keeplist-rules-input"
              spellCheck={false}
            />
          </Form.Item>
          {hasBlockRule && hasKeepRule && (
            <p aria-live="polite" className="filter-rules-warning" role="note">
              {polyglot.t("feed_table.filter_rules_both_warning")}
            </p>
          )}
          {hasDirtyRules && initialFeedHasError && (
            <p
              aria-live="polite"
              className="filter-rules-warning"
              data-testid="feed-error-reset-warning"
              role="note"
            >
              {polyglot.t("feed_table.filter_rules_feed_error_reset_warning")}
            </p>
          )}
          {saveError && (
            <p aria-live="assertive" className="filter-rules-error" role="alert">
              {saveError}
            </p>
          )}
        </section>
      </Form>
      <Link href={minifluxEditUrl} target="_blank">
        {polyglot.t("feed_table.modal_edit_feed_miniflux_link")}
      </Link>
    </AccessibleModal>
  )
}

export default EditFeedModal
