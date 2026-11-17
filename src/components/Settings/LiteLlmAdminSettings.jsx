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
import { authState } from "@/store/authState"
import { getAuthSessionKey, hasProvisionedApiKey } from "@/utils/auth"

import "./LiteLLMAdminSettings.css"

const LiteLlmAdminSettings = ({ onPolicyChanged }) => {
  const { polyglot } = useStore(polyglotState)
  const auth = useStore(authState)
  const sessionKey = getAuthSessionKey(auth)
  const [page, setPage] = useState({ kind: "loading", status: null, models: [], policy: null })
  const [secret, setSecret] = useState("")
  const [verified, setVerified] = useState(false)
  const [selectedAlias, setSelectedAlias] = useState("")
  const [allowPaid, setAllowPaid] = useState(false)
  const [allowExternal, setAllowExternal] = useState(false)
  const [busy, setBusy] = useState(false)

  const t = (name) => polyglot.t(`article_intelligence.litellm_${name}`)

  const load = useCallback(
    async (signal) => {
      if (!hasProvisionedApiKey(auth)) {
        setPage({ kind: "hidden", status: null, models: [], policy: null })
        return
      }
      try {
        const status = await readLiteLLMStatus({ signal })
        if (!status || signal?.aborted) {
          return
        }
        let models = []
        let policy = null
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
          } catch {
            // A broken catalog must not hide the credential status or enable approvals.
          }
        }
        if (!signal?.aborted) {
          setPage({ kind: "ready", status, models, policy })
        }
      } catch (error) {
        if (!signal?.aborted) {
          setPage({
            kind:
              error instanceof AdminLiteLLMError && error.status === 403 ? "hidden" : "unavailable",
            status: null,
            models: [],
            policy: null,
          })
        }
      }
    },
    [auth, sessionKey],
  )

  useEffect(() => {
    const controller = new AbortController()
    // The component is keyed by the Miniflux session: unmount clears transient
    // credentials and selections without synchronous setState in this effect.
    void load(controller.signal)
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
  const candidate = page.models.find((entry) => entry.id === selectedAlias)
  const canApprove = Boolean(
    candidate?.mode === "chat" &&
    candidate?.identity_verified &&
    (candidate.local_ollama || candidate.price_known) &&
    !candidate.approved &&
    (candidate.local_ollama || allowExternal),
  )

  const testConnection = async () => {
    setBusy(true)
    try {
      const result = await testLiteLLMKey(secret)
      if (result?.validated) {
        setVerified(true)
        Message.success(t("test_success"))
      } else {
        Message.error(t("failed"))
      }
    } catch {
      Message.error(t("failed"))
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
      setSecret("")
      setVerified(false)
      setAllowExternal(false)
      setAllowPaid(false)
      await load()
      if (changedPolicy) {
        onPolicyChanged?.()
      }
      Message.success(successMessage)
    } catch {
      Message.error(t("failed"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingSection title={t("section")}>
      <SettingItem description={t("status_description")} title={t("status")}>
        <div className="ai-litellm-admin__status" role="status">
          <Typography.Text>
            {status.configured ? t("connected") : t("not_configured")}
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
            placeholder={t("key_placeholder")}
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
              <Button
                disabled={busy}
                onClick={() => {
                  setSecret("")
                  setVerified(false)
                }}
              >
                {t("cancel")}
              </Button>
            )}
          </div>
          {!status.writes_enabled && (
            <Typography.Text type="warning">{t("writes_disabled")}</Typography.Text>
          )}
        </div>
      </SettingItem>
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
                {model.id} · {model.provider} {model.approved ? "✓" : ""}
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
                {candidate.approved ? t("approved") : t("not_approved")}
              </Typography.Text>
              {!candidate.local_ollama && (
                <Checkbox checked={allowExternal} disabled={busy} onChange={setAllowExternal}>
                  {t("external_consent")}
                </Checkbox>
              )}
              <Checkbox checked={allowPaid} disabled={busy} onChange={setAllowPaid}>
                {t("paid_consent")}
              </Checkbox>
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
    </SettingSection>
  )
}

export default LiteLlmAdminSettings
