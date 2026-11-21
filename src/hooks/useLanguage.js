import { useStore } from "@nanostores/react"
import dayjs from "dayjs"
import "dayjs/locale/en"
import { map } from "nanostores"
import Polyglot from "node-polyglot"
import { useEffect } from "react"

import { settingsState, updateSettings } from "@/store/settingsState"
import { getBrowserLanguage } from "@/utils/locales"
import createSetter from "@/utils/nanostores"
import { applyRuntimeProductIdentity } from "@/utils/product-identity"

export const polyglotState = map({
  polyglot: null,
})
const setPolyglot = createSetter(polyglotState, "polyglot")

const loadLanguage = async (language, polyglot) => {
  let phrases
  let locale = language

  try {
    const phrasesModule = await import(`../locales/${language}.json`)
    phrases = applyRuntimeProductIdentity(phrasesModule.default)
  } catch (error) {
    console.error("Failed to load language:", error)
    const fallbackModule = await import("@/locales/en-US.json")
    phrases = applyRuntimeProductIdentity(fallbackModule.default)
    locale = "en-US"
  }

  if (polyglot) {
    polyglot.replace(phrases)
    polyglot.locale(locale)
    setPolyglot(polyglot)
  } else {
    const newPolyglot = new Polyglot({
      phrases: phrases,
      locale: locale,
    })
    setPolyglot(newPolyglot)
  }
}

const useLanguage = () => {
  const { language } = useStore(settingsState, { keys: ["language"] })

  useEffect(() => {
    if (language) {
      loadLanguage(language)
      dayjs.locale("en")
    } else {
      updateSettings({ language: getBrowserLanguage() })
    }
  }, [language])
}

export default useLanguage
