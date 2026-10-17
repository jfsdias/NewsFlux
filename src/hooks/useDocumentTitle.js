import { useStore } from "@nanostores/react"
import { useEffect } from "react"
import { useParams } from "react-router"

import { polyglotState } from "@/hooks/useLanguage"
import { contentState } from "@/store/contentState"
import { catalogCategoriesState, catalogFeedsState } from "@/store/dataState"
import { PRODUCT_NAME } from "@/utils/constants"
import getEntryDisplayTitle from "@/utils/entry-display-title"

const useDocumentTitle = () => {
  const { activeContent, infoFrom } = useStore(contentState, {
    keys: ["activeContent", "infoFrom"],
  })
  const { polyglot } = useStore(polyglotState)
  const { id } = useParams()
  const feeds = useStore(catalogFeedsState)
  const categories = useStore(catalogCategoriesState)

  let title = ""
  if (activeContent) {
    title = getEntryDisplayTitle(activeContent.title, polyglot.t("article_card.untitled_article"))
  } else if (id && infoFrom === "category") {
    title = categories.find((category) => category.id === Number(id))?.title ?? ""
  } else if (id && infoFrom === "feed") {
    title = feeds.find((feed) => feed.id === Number(id))?.title ?? ""
  } else {
    const pathToKey = {
      home: "settings.post_login_page_option_home",
      all: "sidebar.all",
      starred: "sidebar.starred",
      history: "sidebar.history",
      today: "sidebar.today",
    }

    const translationKey = pathToKey[infoFrom]
    title = translationKey ? polyglot.t(translationKey) : ""
  }

  const hasTitle = typeof title === "string" && title.trim().length > 0
  const pageTitle = hasTitle ? title : PRODUCT_NAME

  useEffect(() => {
    document.title = hasTitle ? `${title} - ${PRODUCT_NAME}` : PRODUCT_NAME
  }, [hasTitle, title])

  return pageTitle
}

export default useDocumentTitle
