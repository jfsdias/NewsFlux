import { Button, Message, Modal, Switch } from "@arco-design/web-react"
import { useStore } from "@nanostores/react"
import { useState } from "react"

import SettingItem from "./SettingItem"
import SettingSection from "./SettingSection"

import { probeReadingSignals } from "@/apis/reading-signals"
import { polyglotState } from "@/hooks/useLanguage"
import {
  learnFromReadingState,
  resetReadingSignals,
  setLearnFromReading,
} from "@/store/readingSignalsState"
import { confirmDialogProps, destructiveConfirmButtonProps } from "@/utils/confirm-dialog"

// NF-0903: opt-in learning. Turning it on first checks that the reading-signals service is
// reachable on this server; otherwise the setting stays off and nothing is sent.
const ReadingSignals = () => {
  const { polyglot } = useStore(polyglotState)
  const enabled = useStore(learnFromReadingState)
  const [checking, setChecking] = useState(false)

  const handleChange = async (value) => {
    if (!value) {
      setLearnFromReading(false)
      return
    }
    setChecking(true)
    try {
      if (await probeReadingSignals()) {
        setLearnFromReading(true)
      } else {
        Message.warning(polyglot.t("settings.learn_from_reading_unavailable"))
      }
    } finally {
      setChecking(false)
    }
  }

  const handleReset = () => {
    Modal.confirm({
      ...confirmDialogProps,
      title: polyglot.t("settings.learn_from_reading_reset_title"),
      content: <p>{polyglot.t("settings.learn_from_reading_reset_content")}</p>,
      okText: polyglot.t("settings.learn_from_reading_reset_confirm"),
      okButtonProps: destructiveConfirmButtonProps,
      cancelText: polyglot.t("search.cancel"),
      onOk: async () => {
        try {
          await resetReadingSignals()
          Message.success(polyglot.t("settings.learn_from_reading_reset_done"))
        } catch {
          Message.error(polyglot.t("settings.learn_from_reading_reset_error"))
        }
      },
    })
  }

  return (
    <SettingSection title={polyglot.t("settings.section_learning")}>
      <SettingItem
        description={polyglot.t("settings.learn_from_reading_description")}
        title={polyglot.t("settings.learn_from_reading_label")}
      >
        <Switch
          aria-label={polyglot.t("settings.learn_from_reading_label")}
          checked={enabled}
          loading={checking}
          onChange={handleChange}
        />
      </SettingItem>
      <SettingItem
        description={polyglot.t("settings.learn_from_reading_reset_description")}
        title={polyglot.t("settings.learn_from_reading_reset_label")}
      >
        <Button status="danger" onClick={handleReset}>
          {polyglot.t("settings.learn_from_reading_reset_confirm")}
        </Button>
      </SettingItem>
    </SettingSection>
  )
}

export default ReadingSignals
