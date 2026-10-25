import { Divider, Tag, Typography } from "@arco-design/web-react"
import { useStore } from "@nanostores/react"
import ReactHtmlParser, { attributesToProps, domToReact } from "html-react-parser"
import { littlefoot } from "littlefoot"
import {
  forwardRef,
  lazy,
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { Link, useNavigate } from "react-router"

import ActionButtons from "./ActionButtons"
import ArticleEnclosures from "./ArticleEnclosures"
import ArticleTable from "./ArticleTable"
import DeferredCodeBlock from "./DeferredCodeBlock"
import EnclosurePlayer from "./EnclosurePlayer"
import ImageLinkTag from "./ImageLinkTag"
import ImageOverlayButton from "./ImageOverlayButton"

import AdaptiveScrollArea from "@/components/ui/AdaptiveScrollArea"
import FadeTransition from "@/components/ui/FadeTransition"
import FeedSourceMark from "@/components/ui/FeedSourceMark"
import PlyrPlayer from "@/components/ui/LazyPlyrPlayer"
import { polyglotState } from "@/hooks/useLanguage"
import usePhotoSlider from "@/hooks/usePhotoSlider"
import useScreenWidth, { prefersReducedMotionState } from "@/hooks/useScreenWidth"
import { activeContentState } from "@/store/contentState"
import { catalogFeedsByIdState } from "@/store/dataState"
import { articleDetailSettingsState } from "@/store/settingsState"
import returnToArticleImage from "@/utils/article-image-return"
import extractCodeContent from "@/utils/code-content"
import { getCodeLanguage } from "@/utils/code-languages"
import { generateReadableDate, generateReadingTime } from "@/utils/date"
import getEntryDisplayTitle from "@/utils/entry-display-title"
import buildArticleImageModel from "@/utils/images"
import { getReaderSourceIdentity } from "@/utils/source-identity"
import { getSafeExternalUrl } from "@/utils/url"
import "./ArticleDetail.css"
import "./ReaderStyles.css"
import "./littlefoot.css"

const ArticleLightbox = lazy(() => import("./ArticleLightbox"))
const EMPTY_ATTACHMENTS = { items: [], primaryMedia: null }

const renderCodeBlock = (preElement) => {
  const codeElement = preElement.children?.find((child) => child.name === "code") ?? preElement

  return (
    <DeferredCodeBlock languageHint={getCodeLanguage(preElement)}>
      {extractCodeContent(codeElement)}
    </DeferredCodeBlock>
  )
}

const handleLinkWithImage = (node, getImageIndex, togglePhotoSlider) => {
  const imgNodes = node.children.filter((child) => child.type === "tag" && child.name === "img")

  if (imgNodes.length > 0) {
    // If there are multiple images, render them with link display
    if (imgNodes.length > 1) {
      return (
        <div className="image-wrapper">
          <div className="image-container">
            {imgNodes.map((imgNode, index) => (
              <div key={`link-img-${index}`}>
                {handleImage(imgNode, getImageIndex, togglePhotoSlider)}
              </div>
            ))}
            <ImageLinkTag href={node.attribs.href} />
          </div>
        </div>
      )
    }

    // Single image case
    const index = getImageIndex(imgNodes[0].attribs.src)
    if (index < 0) {
      return node
    }

    return (
      <ImageOverlayButton
        isLinkWrapper
        index={index}
        node={node}
        togglePhotoSlider={togglePhotoSlider}
      />
    )
  }
  return node
}

const handleBskyVideo = (node) => {
  const isBskyVideo = /video\.bsky\.app.*thumbnail\.jpg$/.test(node.attribs.src)
  if (isBskyVideo) {
    const thumbnailUrl = node.attribs.src
    const playlistUrl = thumbnailUrl.replace("thumbnail.jpg", "playlist.m3u8")

    return <PlyrPlayer poster={thumbnailUrl} src={playlistUrl} />
  }
  return null
}

const getOptimizedImageProps = (node) => {
  const imageProps = attributesToProps(node.attribs, "img")
  return {
    ...imageProps,
    decoding: imageProps.decoding ?? "async",
    loading: imageProps.loading ?? "lazy",
  }
}

const handleImage = (node, getImageIndex, togglePhotoSlider) => {
  const bskyVideoPlayer = handleBskyVideo(node)
  if (bskyVideoPlayer) {
    return bskyVideoPlayer
  }

  const index = getImageIndex(node.attribs.src)
  if (index < 0) {
    return <img {...getOptimizedImageProps(node)} />
  }

  return <ImageOverlayButton index={index} node={node} togglePhotoSlider={togglePhotoSlider} />
}

const handleTableBasedCode = (node) => {
  const tbody = node.children.find((child) => child.name === "tbody")
  if (!tbody) {
    return null
  }

  const tr = tbody.children.find((child) => child.name === "tr")
  if (!tr) {
    return null
  }

  // Filter for td elements to handle whitespace text nodes
  const tdElements = tr.children.filter((child) => child.name === "td")
  if (tdElements.length !== 2) {
    return null
  }

  const [, codeTd] = tdElements
  const codePre = codeTd.children.find((child) => child.name === "pre")

  if (!codePre) {
    return null
  }

  return codePre
}

// Preserve presentational tables; normalize and wrap data tables for horizontal scrolling.
const handleContentTable = (node, parserOptions) => {
  const tableRole = node.attribs?.role?.trim().toLowerCase()
  if (tableRole === "none" || tableRole === "presentation") {
    return node
  }

  const tbody = node.children.find((child) => child.name === "tbody")
  if (tbody) {
    for (const row of tbody.children) {
      if (row.name !== "tr") {
        continue
      }

      // Keep empty cells because their positions and spans are part of the table's semantics.
      row.children = row.children.filter(({ name }) => name === "td" || name === "th")
    }
  }

  return <ArticleTable node={node} options={parserOptions} />
}

// Helper function to process figcaption content
const processFigcaptionContent = (children) => {
  if (!children) {
    return null
  }

  return children.map((child, index) => {
    if (child.type === "text") {
      return child.data
    }
    if (child.type === "tag") {
      const Tag = child.name
      const props = attributesToProps(child.attribs, child.name)

      if (child.name === "br") {
        return null
      }

      if (!child.children?.length) {
        return <Tag key={index} {...props} />
      }

      return (
        <Tag key={index} {...props}>
          {child.children ? processFigcaptionContent(child.children) : null}
        </Tag>
      )
    }
    return null
  })
}

const handleFigure = (node, getImageIndex, togglePhotoSlider, options) => {
  const firstChild = node.children[0]
  const hasImages = node.children.some((child) => child.name === "img")

  // Handle code blocks wrapped in figure
  if (firstChild?.name === "pre") {
    const codeElement = firstChild.children?.find((child) => child.name === "code") ?? firstChild
    return extractCodeContent(codeElement) ? renderCodeBlock(firstChild) : null
  }

  // Handle table-based code blocks with line numbers
  if (firstChild?.name === "table") {
    const codePre = handleTableBasedCode(firstChild)
    if (!codePre) {
      return null
    }

    const codeElement = codePre.children?.find((child) => child.name === "code") ?? codePre
    return extractCodeContent(codeElement) ? renderCodeBlock(codePre) : null
  }

  // Handle multiple images in figure with figcaption support
  if (hasImages) {
    return (
      <figure>
        {node.children.map((child, index) => {
          if (child.name === "img") {
            return (
              <div key={`figure-img-${index}`}>
                {handleImage(child, getImageIndex, togglePhotoSlider)}
              </div>
            )
          }
          if (child.name === "figcaption") {
            return (
              <figcaption key={`figure-caption-${index}`}>
                {processFigcaptionContent(child.children)}
              </figcaption>
            )
          }
          return domToReact([child], options)
        })}
      </figure>
    )
  }

  return null
}

const handleCodeBlock = (node) => {
  // Remove line number text for code blocks in VuePress / VitePress
  let currentNode = node.next
  while (currentNode) {
    const nextNode = currentNode.next
    const isLineNumber = currentNode.type === "text" && /^\d+(<br>|\n)*/.test(currentNode.data)
    const isBreak = currentNode.type === "tag" && currentNode.name === "br"

    if (isLineNumber || isBreak) {
      currentNode.data = ""
      currentNode.type = "text"
    }
    currentNode = nextNode
  }

  return renderCodeBlock(node)
}

const handleVideo = (node) => {
  const sourceNode = node.children?.find((child) => child.name === "source" && child.attribs?.src)

  const videoSrc = sourceNode?.attribs.src || node.attribs.src

  if (!videoSrc) {
    return node
  }

  return (
    <PlyrPlayer poster={node.attribs.poster} sourceType={sourceNode?.attribs.type} src={videoSrc} />
  )
}

const handleIframe = (node) => {
  const src = node.attribs?.src
  if (!src) {
    return node
  }

  const iframeProps = attributesToProps(node.attribs, "iframe")
  const isYouTube = src.includes("youtube.com") || src.includes("youtube-nocookie.com")

  return (
    <iframe
      {...iframeProps}
      loading={iframeProps.loading ?? "lazy"}
      referrerPolicy={
        iframeProps.referrerPolicy ?? (isYouTube ? "strict-origin-when-cross-origin" : undefined)
      }
    />
  )
}

const getHtmlParserOptions = (getImageIndex, togglePhotoSlider) => {
  const options = {
    replace: (node) => {
      if (node.type !== "tag") {
        return node
      }

      switch (node.name) {
        case "h1": {
          return (
            <h2 {...attributesToProps(node.attribs, "h2")}>{domToReact(node.children, options)}</h2>
          )
        }
        case "a": {
          return node.children.length > 0
            ? handleLinkWithImage(node, getImageIndex, togglePhotoSlider)
            : node
        }
        case "img": {
          return handleImage(node, getImageIndex, togglePhotoSlider)
        }
        case "pre": {
          return handleCodeBlock(node)
        }
        case "figure": {
          return handleFigure(node, getImageIndex, togglePhotoSlider, options)
        }
        case "video": {
          return handleVideo(node)
        }
        case "iframe": {
          return handleIframe(node)
        }
        case "table": {
          return handleContentTable(node, options)
        }
        default: {
          return node
        }
      }
    },
  }
  return options
}

const ArticleDetail = forwardRef((_, ref) => {
  const navigate = useNavigate()
  const { isBelowMedium } = useScreenWidth()
  const prefersReducedMotion = useStore(prefersReducedMotionState)
  const { polyglot } = useStore(polyglotState)

  const activeContent = useStore(activeContentState)
  const catalogFeedsById = useStore(catalogFeedsByIdState)
  const resolvedFeed = catalogFeedsById.get(String(activeContent.feed.id)) ?? activeContent.feed
  const readerSourceIdentity = getReaderSourceIdentity(resolvedFeed)
  const sourceFeedId = resolvedFeed?.id
  const sourceFeedNumber = Number(sourceFeedId)
  const sourceFeedPath =
    Number.isSafeInteger(sourceFeedNumber) && sourceFeedNumber > 0
      ? `/feed/${sourceFeedNumber}`
      : null
  const displayTitle = getEntryDisplayTitle(
    activeContent.title,
    polyglot.t("article_card.untitled_article"),
  )
  const activeContentHtml = activeContent.content ?? ""
  const deferredContentHtml = useDeferredValue(activeContentHtml, "")
  const isArticleBodyPending = deferredContentHtml !== activeContentHtml
  const renderableContentHtml = isArticleBodyPending ? "" : deferredContentHtml
  const {
    articleWidth,
    contentBrowsingDirection,
    edgeToEdgeImages,
    fontFamily,
    fontSize,
    lightboxSlideAnimation,
    showFeedIcon,
    titleAlignment,
  } = useStore(articleDetailSettingsState)
  const scrollContainerRef = useRef(null)
  const photoSliderSessionRef = useRef(null)
  const preparedPhotoSliderSessionRef = useRef(false)
  const previousPhotoSliderVisibleRef = useRef(false)
  const [enclosuresOpenState, setEnclosuresOpenState] = useState({ articleId: null, open: false })
  const [hasOpenedPhotoSlider, setHasOpenedPhotoSlider] = useState(false)

  const {
    completePhotoSliderClose,
    isPhotoSliderCloseRequested,
    isPhotoSliderVisible,
    markPhotoSliderClosing,
    openPhotoSlider,
    resetPhotoSlider,
    selectedIndex,
    setSelectedIndex,
  } = usePhotoSlider()

  const capturePhotoSliderSession = useCallback(
    (index, { targetElement = null } = {}) => {
      const scrollElement = scrollContainerRef.current?.getScrollElement()
      if (!scrollElement) {
        return false
      }

      const openingTarget = targetElement?.isConnected ? targetElement : null
      photoSliderSessionRef.current = {
        articleId: activeContent.id,
        currentIndex: index,
        hasViewedDifferentSlide: false,
        openingIndex: index,
        openingInstanceId: openingTarget?.dataset.articleImageInstance ?? null,
        openingScrollTop: scrollElement.scrollTop,
        openingTarget,
        openingViewportCenter: scrollElement.scrollTop + scrollElement.clientHeight / 2,
        pendingReturnIndex: null,
      }
      return true
    },
    [activeContent.id],
  )

  const togglePhotoSlider = useCallback(
    (index, source) => {
      preparedPhotoSliderSessionRef.current = capturePhotoSliderSession(index, source)
      setHasOpenedPhotoSlider(true)
      openPhotoSlider(index)
    },
    [capturePhotoSliderSession, openPhotoSlider],
  )

  const lightboxAnimationConfig = useMemo(() => {
    if (prefersReducedMotion) {
      return { fade: 0, navigation: 0 }
    }
    return lightboxSlideAnimation ? { fade: 250 } : { fade: 250, navigation: 0 }
  }, [lightboxSlideAnimation, prefersReducedMotion])

  const attachments = activeContent.attachments ?? EMPTY_ATTACHMENTS
  const { items: attachmentItems, primaryMedia } = attachments
  const { getImageIndex, imageSlides, visibleAttachments } = useMemo(
    () => buildArticleImageModel(renderableContentHtml, attachmentItems),
    [attachmentItems, renderableContentHtml],
  )
  const enclosuresOpen =
    enclosuresOpenState.articleId === activeContent.id && enclosuresOpenState.open
  const htmlParserOptions = useMemo(
    () => getHtmlParserOptions(getImageIndex, togglePhotoSlider),
    [getImageIndex, togglePhotoSlider],
  )
  const parsedHtml = useMemo(
    () => ReactHtmlParser(renderableContentHtml, htmlParserOptions),
    [htmlParserOptions, renderableContentHtml],
  )

  const handlePhotoSliderView = ({ index }) => {
    const session = photoSliderSessionRef.current
    if (session) {
      session.currentIndex = index
      if (index !== session.openingIndex) {
        session.hasViewedDifferentSlide = true
      }
    }
    setSelectedIndex(index)
  }

  const handlePhotoSliderExiting = () => {
    markPhotoSliderClosing()

    const session = photoSliderSessionRef.current
    if (!session || session.articleId !== activeContent.id) {
      return
    }

    const index = session.currentIndex
    session.pendingReturnIndex = index

    const isAttachmentSlide = visibleAttachments.some(
      ({ galleryIndex }) => Number.isInteger(galleryIndex) && galleryIndex === index,
    )
    if (isAttachmentSlide) {
      setEnclosuresOpenState({ articleId: activeContent.id, open: true })
    }
  }

  const handlePhotoSliderExited = () => {
    const session = photoSliderSessionRef.current
    const scrollElement = scrollContainerRef.current?.getScrollElement()

    if (
      !session ||
      session.pendingReturnIndex === null ||
      !scrollElement ||
      session.articleId !== activeContent.id
    ) {
      return
    }

    const galleryIndex = session.pendingReturnIndex
    session.pendingReturnIndex = null
    const isCurrentSession = () => photoSliderSessionRef.current === session

    void returnToArticleImage({
      galleryIndex,
      hasViewedDifferentSlide: session.hasViewedDifferentSlide,
      isCurrent: isCurrentSession,
      openingIndex: session.openingIndex,
      openingInstanceId: session.openingInstanceId,
      openingScrollTop: session.openingScrollTop,
      openingTarget: session.openingTarget,
      openingViewportCenter: session.openingViewportCenter,
      scrollElement,
    }).then(() => {
      if (isCurrentSession()) {
        photoSliderSessionRef.current = null
      }
      return null
    })
  }

  const handleEnclosuresOpenChange = (open) => {
    setEnclosuresOpenState({ articleId: activeContent.id, open })
  }

  const { id: categoryId, title: categoryTitle } = activeContent.feed.category

  const { coverSource } = activeContent
  const sourceUrl = getSafeExternalUrl(activeContent.url)

  const responsiveMaxWidth = isBelowMedium ? "90%" : `${articleWidth}ch`

  useLayoutEffect(() => {
    return () => {
      photoSliderSessionRef.current = null
      preparedPhotoSliderSessionRef.current = false
      previousPhotoSliderVisibleRef.current = false
      resetPhotoSlider()
    }
  }, [activeContent.id, resetPhotoSlider])

  useLayoutEffect(() => {
    const wasPhotoSliderVisible = previousPhotoSliderVisibleRef.current

    if (isPhotoSliderVisible && !wasPhotoSliderVisible) {
      if (!preparedPhotoSliderSessionRef.current) {
        capturePhotoSliderSession(selectedIndex)
      }
      preparedPhotoSliderSessionRef.current = false
    } else if (!isPhotoSliderVisible) {
      preparedPhotoSliderSessionRef.current = false
    }

    previousPhotoSliderVisibleRef.current = isPhotoSliderVisible
  }, [capturePhotoSliderSession, isPhotoSliderVisible, selectedIndex])

  useEffect(() => {
    if (isPhotoSliderVisible) {
      setHasOpenedPhotoSlider(true)
    }
  }, [isPhotoSliderVisible])

  // pretty footnotes
  useEffect(() => {
    if (isArticleBodyPending) {
      return
    }

    const lf = littlefoot()
    return () => {
      lf.unmount()
    }
  }, [activeContent.id, isArticleBodyPending])

  // Focus the scrollable area when activeContent changes
  useEffect(() => {
    if (scrollContainerRef.current) {
      const scrollElement = scrollContainerRef.current.getScrollElement()
      scrollElement?.focus()
    }
  }, [activeContent.id])

  return (
    <article
      ref={ref}
      className={`article-content ${edgeToEdgeImages ? "edge-to-edge" : ""}`}
      tabIndex={-1}
      style={{
        "--article-width": articleWidth,
        "--reader-fs": `${fontSize}rem`,
        "--reader-family": fontFamily,
      }}
    >
      <AdaptiveScrollArea
        ref={scrollContainerRef}
        className="scroll-container"
        scrollableNodeProps={{ tabIndex: -1 }}
      >
        <ActionButtons
          isPhotoSliderVisible={isPhotoSliderVisible}
          scrollContainerRef={scrollContainerRef}
        />
        <FadeTransition>
          <div
            className="article-header"
            style={{ maxWidth: responsiveMaxWidth, textAlign: titleAlignment }}
          >
            <div className="article-header-column">
              {readerSourceIdentity.displayName && (
                <div className="article-source">
                  {sourceFeedPath ? (
                    <Link className="article-source-link" to={sourceFeedPath}>
                      {showFeedIcon && <FeedSourceMark feed={resolvedFeed} size={24} />}
                      <span className="article-source-copy">
                        <span className="article-source-name">
                          {readerSourceIdentity.displayName}
                        </span>
                        {readerSourceIdentity.secondaryHostname && (
                          <span className="article-source-host">
                            {readerSourceIdentity.secondaryHostname}
                          </span>
                        )}
                      </span>
                    </Link>
                  ) : (
                    <div className="article-source-link article-source-link--static">
                      {showFeedIcon && <FeedSourceMark feed={resolvedFeed} size={24} />}
                      <span className="article-source-copy">
                        <span className="article-source-name">
                          {readerSourceIdentity.displayName}
                        </span>
                        {readerSourceIdentity.secondaryHostname && (
                          <span className="article-source-host">
                            {readerSourceIdentity.secondaryHostname}
                          </span>
                        )}
                      </span>
                    </div>
                  )}
                </div>
              )}
              <Typography.Title
                className="article-title"
                heading={1}
                style={{ fontFamily: fontFamily }}
              >
                {sourceUrl ? (
                  <a href={sourceUrl} rel="noopener" target="_blank">
                    {displayTitle}
                  </a>
                ) : (
                  displayTitle
                )}
              </Typography.Title>
              <div className="article-meta">
                {activeContent.author && <Typography.Text>{activeContent.author}</Typography.Text>}
                <Typography.Text>
                  <Tag
                    size="small"
                    style={{ marginLeft: "10px", cursor: "pointer" }}
                    onClick={() => navigate(`/category/${categoryId}`)}
                  >
                    {categoryTitle}
                  </Tag>
                </Typography.Text>
              </div>
              <Typography.Text className="article-date">
                {generateReadableDate(activeContent.published_at)}
              </Typography.Text>
              <br />
              <Typography.Text className="article-date">
                {generateReadingTime(activeContent.reading_time)}
              </Typography.Text>
              <Divider />
            </div>
          </div>
          <div
            key={activeContent.id}
            aria-busy={isArticleBodyPending || undefined}
            className="article-body"
            style={{
              fontSize: `${fontSize}rem`,
              maxWidth: responsiveMaxWidth,
              fontFamily: fontFamily,
            }}
          >
            {isArticleBodyPending ? (
              <div className="article-body-loading" />
            ) : (
              <>
                {primaryMedia && (
                  <EnclosurePlayer
                    key={primaryMedia.id ?? primaryMedia.url}
                    enclosure={primaryMedia}
                    poster={coverSource}
                  />
                )}
                {parsedHtml}
                <ArticleEnclosures
                  items={visibleAttachments}
                  open={enclosuresOpen}
                  onImagePreview={togglePhotoSlider}
                  onOpenChange={handleEnclosuresOpenChange}
                />
                {hasOpenedPhotoSlider && (
                  <Suspense fallback={null}>
                    <ArticleLightbox
                      animation={lightboxAnimationConfig}
                      closeRequested={isPhotoSliderCloseRequested}
                      direction={contentBrowsingDirection}
                      index={selectedIndex}
                      open={isPhotoSliderVisible}
                      slides={imageSlides}
                      onClose={completePhotoSliderClose}
                      onExited={handlePhotoSliderExited}
                      onExiting={handlePhotoSliderExiting}
                      onView={handlePhotoSliderView}
                    />
                  </Suspense>
                )}
              </>
            )}
          </div>
        </FadeTransition>
      </AdaptiveScrollArea>
    </article>
  )
})
ArticleDetail.displayName = "ArticleDetail"

export default ArticleDetail
