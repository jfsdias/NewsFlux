import { Button, Checkbox, Input, Message, Select, Typography } from "@arco-design/web-react"
import { useStore } from "@nanostores/react"
import { useCallback, useEffect, useState } from "react"

import SettingItem from "./SettingItem"
import SettingSection from "./SettingSection"

import {
  AdminLiteLLMError,
  approveLiteLLMModel,
  readLiteLLMModels,
  readLiteLLMPolicy,
  readLiteLLMStatus,
  removeLiteLLMModel,
  replaceLiteLLMKey,
  testLiteLLMKey,
} from "@/apis/article-intelligence-admin"
import { polyglotState } from "@/hooks/useLanguage"
import {
  canApproveModel,
  connectionState,
  errorMessageKey,
  isKeyAuthority,
  keyAuthorityModelLabel,
  priceLabelKey,
} from "@/utils/litellm-admin-state"

import "./LiteLLMAdminSettings.css"

const LiteLlmAdminSettings = ({ onPolicyChanged }) => {
  const { polyglot } = useStore(polyglotState)
  const [page, setPage] = useState({
    kind: "loading",
    status: null,
    models: [],
    policy: null,
    discovery: "idle",
  })
  const [secret, setSecret] = useState("")
  const [verified, setVerified] = useState(false)
  const [selectedAlias, setSelectedAlias] = useState("")
  const [allowPaid, setAllowPaid] = useState(false)
  const [allowExternal, setAllowExternal] = useState(false)
  const [busy, setBusy] = useState(false)

  const t = (name) => polyglot.t(`article_intelligence.litellm_${name}`)

  const load = useCallback(async (signal) => {
    try {
      const status = await readLiteLLMStatus({ signal })
      if (!status || signal?.aborted) {
        return
      }
      let models = []
      let policy = null
      let discovery = "idle"
      if (status.configured) {
        try {
          const [discovered, approved] = await Promise.all([
            readLiteLLMModels({ signal }),
            readLiteLLMPolicy({ signal }),
          ])
          if (signal?.aborted || !discovered || !approved) {
            return
          }
          models = Array.isArray(discovered.models) ? discovered.models : []
          policy = approved.policy
          discovery = "ok"
        } catch {
          // A broken catalog must not hide the credential status or enable approvals.
          discovery = "failed"
        }
      }
      if (!signal?.aborted) {
        setPage({ kind: "ready", status, models, policy, discovery })
      }
    } catch (error) {
      if (!signal?.aborted) {
        // Status errors (5xx) happen only after admin authorization succeeded, so an
        // administrator sees a failed state instead of a silently missing panel.
        const adminFailure = error instanceof AdminLiteLLMError && error.status >= 500
        setPage({
          kind: adminFailure ? "ready" : error?.status === 403 ? "hidden" : "unavailable",
          status: adminFailure ? { status_error: true, configured: false } : null,
          models: [],
          policy: null,
          discovery: "failed",
        })
      }
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    // The component is keyed by the Miniflux session: unmount clears transient
    // credentials and selections without synchronous setState in this effect.
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        void load(controller.signal)
      }
    })
    return () => controller.abort()
  }, [load])

  if (page.kind === "hidden") {
    return null
  }
  if (page.kind === "loading") {
    return <Typography.Text role="status">{t("loading")}</Typography.Text>
  }
  if (page.kind === "unavailable") {
    return null
  }

  const { status } = page
  const connection = connectionState(status, page.discovery)
  const candidate = page.models.find((entry) => entry.id === selectedAlias)
  const canApprove = canApproveModel(candidate, { allowExternal, allowPaid })
  const clearSecret = () => {
    setSecret("")
    setVerified(false)
  }

  const testConnection = async () => {
    setBusy(true)
    try {
      const result = await testLiteLLMKey(secret)
      if (result?.validated) {
        setVerified(true)
        Message.success(t("test_success"))
      } else if (result !== null) {
        clearSecret()
        Message.error(t("failed"))
      }
    } catch (error) {
      // A rejected credential is never kept in the field for another attempt.
      clearSecret()
      Message.error(t(errorMessageKey(error)))
    } finally {
      setBusy(false)
    }
  }

  const refresh = async () => {
    setBusy(true)
    try {
      await load()
    } finally {
      setBusy(false)
    }
  }

  const doAction = async (operation, successMessage, { changedPolicy = false } = {}) => {
    setBusy(true)
    try {
      const updated = await operation()
      if (!updated) {
        return
      }
      setAllowExternal(false)
      setAllowPaid(false)
      await load()
      if (changedPolicy) {
        onPolicyChanged?.()
      }
      Message.success(successMessage)
    } catch (error) {
      Message.error(t(errorMessageKey(error)))
      if (error?.code === "CONFIG_CONFLICT") {
        await load()
      }
    } finally {
      // The transient credential is cleared after every save attempt.
      clearSecret()
      setBusy(false)
    }
  }

  return (
    <SettingSection title={t("section")}>
      <SettingItem description={t("status_description")} title={t("status")}>
        <div className="ai-litellm-admin__status" role="status">
          <Typography.Text
            type={
              connection === "connected"
                ? "success"
                : connection === "validation_failed"
                  ? "error"
                  : "secondary"
            }
          >
            {t(`state_${connection}`)}
          </Typography.Text>
          {status.configured && (
            <Typography.Text type="secondary">
              {status.managed ? t("managed") : t("bootstrap")}
            </Typography.Text>
          )}
        </div>
      </SettingItem>
      <SettingItem description={t("key_description")} title={t("key")}>
        <div className="ai-litellm-admin__stack">
          <Input
            aria-label={t("key")}
            autoComplete="off"
            disabled={!status.writes_enabled || busy}
            name="newsflux-litellm-transient-key"
            placeholder={t("key_placeholder")}
            spellCheck={false}
            type="password"
            value={secret}
            onChange={(value) => {
              setSecret(value)
              setVerified(false)
            }}
          />
          <div className="ai-litellm-admin__actions">
            <Button
              disabled={!status.writes_enabled || busy || !secret.startsWith("sk-")}
              loading={busy}
              onClick={() => void testConnection()}
            >
              {t("test")}
            </Button>
            <Button
              disabled={!status.writes_enabled || busy || !verified || !secret}
              type="primary"
              onClick={() =>
                void doAction(() => replaceLiteLLMKey(secret, status.revision), t("saved"))
              }
            >
              {t("replace")}
            </Button>
            {secret && (
              <Button disabled={busy} onClick={clearSecret}>
                {t("cancel")}
              </Button>
            )}
          </div>
          {!status.writes_enabled && (
            <Typography.Text type="warning">{t("writes_disabled")}</Typography.Text>
          )}
        </div>
      </SettingItem>
      {isKeyAuthority(status) ? (
        <SettingItem description={t("key_authority_description")} title={t("models")}>
          <div className="ai-litellm-admin__stack">
            <Button
              disabled={busy || !status.configured}
              loading={busy}
              onClick={() => void refresh()}
            >
              {t("refresh")}
            </Button>
            <Typography.Text type="secondary">{t("key_authority_notice")}</Typography.Text>
            <ul aria-label={t("models")}>
              {page.models.map((model) => (
                <li key={model.id}>{keyAuthorityModelLabel(model)}</li>
              ))}
            </ul>
          </div>
        </SettingItem>
      ) : (
        <SettingItem description={t("models_description")} title={t("models")}>
          <div className="ai-litellm-admin__stack">
            <Button
              disabled={busy || !status.configured}
              loading={busy}
              onClick={() => void refresh()}
            >
              {t("refresh")}
            </Button>
            <Select
              showSearch
              aria-label={t("models")}
              disabled={busy || !status.configured || !status.writes_enabled}
              placeholder={t("choose")}
              value={selectedAlias || undefined}
              onChange={(value) => {
                setSelectedAlias(value)
                setAllowExternal(false)
                setAllowPaid(false)
              }}
            >
              {page.models.map((model) => (
                <Select.Option key={model.id} value={model.id}>
                  {model.id} · {model.provider} · {t(priceLabelKey(model))}{" "}
                  {model.approved ? "✓" : ""}
                </Select.Option>
              ))}
            </Select>
            {candidate && (
              <>
                <Typography.Text type="secondary">
                  {candidate.local_ollama ? t("local") : t("external")}
                  {" · "}
                  {candidate.mode ?? t("unverified")}
                  {" · "}
                  {t(priceLabelKey(candidate))}
                  {" · "}
                  {candidate.approved ? t("approved") : t("not_approved")}
                </Typography.Text>
                {!candidate.local_ollama && (
                  <Checkbox checked={allowExternal} disabled={busy} onChange={setAllowExternal}>
                    {t("external_consent")}
                  </Checkbox>
                )}
                {candidate.price_class === "paid" && (
                  <Checkbox checked={allowPaid} disabled={busy} onChange={setAllowPaid}>
                    {t("paid_consent")}
                  </Checkbox>
                )}
                {!candidate.local_ollama && priceLabelKey(candidate) === "price_unknown" && (
                  <Typography.Text type="warning">{t("price_required")}</Typography.Text>
                )}
                <div className="ai-litellm-admin__actions">
                  {candidate.approved ? (
                    <Button
                      disabled={busy || !status.writes_enabled}
                      status="danger"
                      onClick={() =>
                        void doAction(
                          () => removeLiteLLMModel(selectedAlias, status.revision),
                          t("model_removed"),
                          { changedPolicy: true },
                        )
                      }
                    >
                      {t("remove")}
                    </Button>
                  ) : (
                    <Button
                      disabled={busy || !status.writes_enabled || !canApprove}
                      type="primary"
                      onClick={() =>
                        void doAction(
                          () =>
                            approveLiteLLMModel(
                              selectedAlias,
                              status.revision,
                              allowPaid,
                              allowExternal,
                            ),
                          t("model_approved"),
                          { changedPolicy: true },
                        )
                      }
                    >
                      {t("approve")}
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>
        </SettingItem>
      )}
    </SettingSection>
  )
}

export default LiteLlmAdminSettings
