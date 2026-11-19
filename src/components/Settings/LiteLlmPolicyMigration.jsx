import { Button, Checkbox, Message, Typography } from "@arco-design/web-react"
import { useStore } from "@nanostores/react"
import { useCallback, useEffect, useState } from "react"

import SettingItem from "./SettingItem"
import SettingSection from "./SettingSection"

import {
  migrateLiteLLMPolicy,
  readLiteLLMMigrationPreview,
  readLiteLLMStatus,
} from "@/apis/article-intelligence-admin"
import { polyglotState } from "@/hooks/useLanguage"
import { errorMessageKey } from "@/utils/litellm-admin-state"
import { migrationActions, migrationRowFacts } from "@/utils/litellm-migration-state"

import "./LiteLlmPolicyMigration.css"

// Explicit LEGACY -> MANAGED migration (admin only). The preview is a read-only GET; the
// migration keeps the current key, approves no model and needs a typed confirmation that the
// server re-checks with the revision and a fresh preview. Nothing is kept in browser storage.
const LiteLlmPolicyMigration = ({ onMigrated }) => {
  const { polyglot } = useStore(polyglotState)
  const [status, setStatus] = useState(null)
  const [preview, setPreview] = useState(null)
  const [previewState, setPreviewState] = useState("idle")
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)

  const t = (name, options) => polyglot.t(`article_intelligence.litellm_${name}`, options)

  const loadStatus = useCallback(async (signal) => {
    try {
      const next = await readLiteLLMStatus({ signal })
      if (next && !signal?.aborted) {
        setStatus(next)
      }
    } catch {
      // Hidden for non-admins and on errors; the main admin panel reports failures.
      if (!signal?.aborted) {
        setStatus(null)
      }
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        void loadStatus(controller.signal)
      }
    })
    return () => controller.abort()
  }, [loadStatus])

  const actions = migrationActions(status, preview, confirmed, { busy })
  if (!actions.visible) {
    return null
  }

  const runPreview = async () => {
    setBusy(true)
    setPreviewState("loading")
    setConfirmed(false)
    try {
      const next = await readLiteLLMMigrationPreview()
      if (next) {
        setPreview(next)
        setPreviewState("ready")
      }
    } catch (error) {
      setPreview(null)
      setPreviewState("failed")
      Message.error(t(errorMessageKey(error)))
    } finally {
      setBusy(false)
    }
  }

  const migrate = async () => {
    setBusy(true)
    try {
      const result = await migrateLiteLLMPolicy(status.revision, preview.preview_token)
      if (!result) {
        return
      }
      Message.success(t("migration_done"))
      setPreview(null)
      setConfirmed(false)
      onMigrated?.()
    } catch (error) {
      Message.error(t(errorMessageKey(error)))
      // A stale preview or another writer: a fresh preview is required before trying again.
      setPreview(null)
      setPreviewState("idle")
      setConfirmed(false)
      await loadStatus()
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingSection title={t("migration_section")}>
      <SettingItem description={t("migration_description")} title={t("migration_title")}>
        <div className="ai-litellm-migration">
          <Typography.Text type="warning">{t("migration_effect")}</Typography.Text>
          <Button
            disabled={!actions.canPreview}
            loading={busy && previewState === "loading"}
            onClick={() => void runPreview()}
          >
            {t("migration_preview")}
          </Button>
          {previewState === "loading" && (
            <Typography.Text role="status">{t("migration_loading")}</Typography.Text>
          )}
          {previewState === "failed" && (
            <Typography.Text role="status" type="error">
              {t("migration_preview_failed")}
            </Typography.Text>
          )}
          {preview && (
            <section
              aria-label={t("migration_preview_title")}
              className="ai-litellm-migration__preview"
            >
              <Typography.Text role="status">
                {preview.gateway === "ok"
                  ? t("migration_gateway_ok")
                  : t("migration_gateway_unavailable")}
              </Typography.Text>
              {preview.models.length === 0 ? (
                <Typography.Text type="secondary">{t("migration_no_models")}</Typography.Text>
              ) : (
                <ul className="ai-litellm-migration__models">
                  {preview.models.map((row) => {
                    const facts = migrationRowFacts(row)
                    return (
                      <li key={row.id} className="ai-litellm-migration__model">
                        <Typography.Text bold>{row.label}</Typography.Text>
                        <dl className="ai-litellm-migration__facts">
                          <dt>{t("migration_fact_alias")}</dt>
                          <dd>{row.alias}</dd>
                          <dt>{t("migration_fact_gateway")}</dt>
                          <dd>{t(facts.discovery)}</dd>
                          <dt>{t("migration_fact_mode")}</dt>
                          <dd>{t(facts.mode)}</dd>
                          {facts.identity && (
                            <>
                              <dt>{t("migration_fact_identity")}</dt>
                              <dd>{t(facts.identity)}</dd>
                            </>
                          )}
                          <dt>{t("migration_fact_location")}</dt>
                          <dd>{t(facts.location)}</dd>
                          <dt>{t("migration_fact_price")}</dt>
                          <dd>
                            {t(facts.price)}
                            {facts.legacyPrice && ` · ${t(facts.legacyPrice)}`}
                          </dd>
                          <dt>{t("migration_fact_after")}</dt>
                          <dd>{t(facts.after)}</dd>
                        </dl>
                        {(facts.consents.length > 0 || facts.blockers.length > 0) && (
                          <ul className="ai-litellm-migration__notes">
                            {[...facts.blockers, ...facts.consents].map((key) => (
                              <li key={key}>{t(key)}</li>
                            ))}
                          </ul>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
              <Checkbox
                checked={confirmed}
                disabled={busy || status.writes_enabled !== true || preview.gateway !== "ok"}
                onChange={setConfirmed}
              >
                {t("migration_confirm")}
              </Checkbox>
              {actions.blocker &&
                // Confirmation and gateway state are already shown next to their controls.
                !["migration_confirm_required", "migration_gateway_unavailable"].includes(
                  actions.blocker,
                ) && <Typography.Text type="warning">{t(actions.blocker)}</Typography.Text>}
              <Button
                disabled={!actions.canMigrate}
                status="warning"
                type="primary"
                onClick={() => void migrate()}
              >
                {t("migration_migrate")}
              </Button>
            </section>
          )}
          {!preview && status.writes_enabled !== true && (
            <Typography.Text type="secondary">{t("migration_writes_off")}</Typography.Text>
          )}
        </div>
      </SettingItem>
    </SettingSection>
  )
}

export default LiteLlmPolicyMigration
