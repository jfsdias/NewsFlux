/* eslint-disable react-refresh/only-export-components -- This standalone test harness is not a product module. */
import React, { useCallback } from "react"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"

import LazyPlyrPlayer from "@/components/ui/LazyPlyrPlayer"

const VIDEO_SOURCE = "data:video/mp4;base64,AAAA"
const AUDIO_SOURCE = "data:audio/mpeg;base64,AAAA"
const enclosureVideo = { kind: "video", mime_type: "video/mp4", url: VIDEO_SOURCE }
const enclosureAudio = { kind: "audio", mime_type: "audio/mpeg", url: AUDIO_SOURCE }

const waitFor = async (predicate, label, timeoutMs = 8000) => {
  const startedAt = performance.now()

  while (!predicate()) {
    if (performance.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for ${label}`)
    }

    await new Promise(requestAnimationFrame)
  }
}

const getRelativeTop = (element, scrollRoot) =>
  element.getBoundingClientRect().top -
  scrollRoot.getBoundingClientRect().top +
  scrollRoot.scrollTop

const noop = () => {}

/* eslint-disable unicorn/no-this-outside-of-class -- The media property accessor needs its element receiver. */
const stubMediaSourceAssignments = () => {
  let sourceDescriptor
  let installed = false
  let restored = false

  try {
    sourceDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "src")
    if (!sourceDescriptor?.configurable || !sourceDescriptor.get || !sourceDescriptor.set) {
      return noop
    }

    Object.defineProperty(HTMLMediaElement.prototype, "src", {
      ...sourceDescriptor,
      get() {
        return this.dataset.readerMediaTestSource ?? sourceDescriptor.get.call(this)
      },
      set(value) {
        this.dataset.readerMediaTestSource = value
      },
    })
    installed = true
  } catch {
    if (installed && sourceDescriptor) {
      try {
        Object.defineProperty(HTMLMediaElement.prototype, "src", sourceDescriptor)
      } catch {
        // Best effort: keep harness setup errors from preventing cleanup/reporting.
      }
    }
    return noop
  }

  return () => {
    if (restored) {
      return
    }
    Object.defineProperty(HTMLMediaElement.prototype, "src", sourceDescriptor)
    restored = true
  }
}
/* eslint-enable unicorn/no-this-outside-of-class */

const PlayerCase = ({ enclosure, label, onPlayerInit, src, style, type }) => {
  const reportInit = useCallback((player) => onPlayerInit(type, player), [onPlayerInit, type])

  return (
    <div className="media-case" data-media-case={type}>
      <span className="media-case-label">{label}</span>
      <LazyPlyrPlayer enclosure={enclosure} src={src} style={style} onPlayerInit={reportInit} />
    </div>
  )
}

const ReaderMediaFixture = ({ onPlayerInit }) => (
  <article>
    <PlayerCase
      label="Inline video already in view"
      src={VIDEO_SOURCE}
      type="inline-video"
      onPlayerInit={onPlayerInit}
    />
    <div aria-hidden="true" className="media-spacer" />
    <PlayerCase
      label="Inline video reached by scrolling"
      src={VIDEO_SOURCE}
      type="near-video"
      onPlayerInit={onPlayerInit}
    />
    <div aria-hidden="true" className="media-spacer" />
    <PlayerCase
      enclosure={enclosureVideo}
      label="Enclosure video reached by scrolling"
      src={VIDEO_SOURCE}
      style={{ maxWidth: "100%" }}
      type="enclosure-video"
      onPlayerInit={onPlayerInit}
    />
    <div aria-hidden="true" className="media-spacer" />
    <PlayerCase
      enclosure={enclosureAudio}
      label="Enclosure audio reached by scrolling"
      src={AUDIO_SOURCE}
      style={{ maxWidth: "400px" }}
      type="enclosure-audio"
      onPlayerInit={onPlayerInit}
    />
    <div aria-hidden="true" className="media-spacer" />
    <PlayerCase
      label="Far inline video remains deferred"
      src={VIDEO_SOURCE}
      type="far-video"
      onPlayerInit={onPlayerInit}
    />
    <audio controls aria-label="Native inline audio remains native" data-testid="inline-audio" />
    <iframe
      aria-label="Embedded content remains an iframe"
      loading="lazy"
      src="about:blank"
      title="Existing iframe path"
    />
  </article>
)

const reportElement = document.querySelector("#report")
const runButton = document.querySelector("#run-reader-media")
const scrollRoot = document.querySelector("#reader-scroll")
const articleRoot = document.querySelector("#article-content")
let activeRoot = null

const publishReport = (report) => {
  globalThis.__readerMedia01aReport = report
  const visibleReport = {
    viewport: report.viewport,
    initialPlayerCount: report.playerInitCountBeforeScroll,
    playerCountAfterNearScroll: report.playerInitCountAfterNearScroll,
    playerCountAfterActivation: report.playerInitCountAfterActivation,
    playerCleanupCount: report.playerCleanupCount,
    farMediaDeferred: report.farMediaDeferred,
    nearActivatedBeforeVisible: report.nearMediaActivatedBeforeVisible,
    activationOnce: report.activationOnce,
    cleanupPass: report.cleanupPass,
    layoutStable: report.layoutStable,
    videoLayoutStable: report.videoLayoutStable,
    audioLayoutStable: report.audioLayoutStable,
    mediaTypesPass:
      report.inlineVideoPass && report.enclosureVideoPass && report.enclosureAudioPass,
    inlineAudioPreserved: report.inlineAudioPreserved,
    iframePreserved: report.iframePreserved,
    geometry: report.geometry,
    audioGeometry: report.audioGeometry,
    errors: report.errors,
    summary: report.summary,
  }
  reportElement.textContent = JSON.stringify(visibleReport, null, 2)
}

const runHarness = async () => {
  const playerInits = []
  const playerCleanups = []
  const failures = []
  let restoreMediaSource = noop
  let report = {
    viewport: null,
    observerSupported: false,
    playerInitCountBeforeScroll: null,
    farMediaDeferred: null,
    nearMediaActivatedBeforeVisible: null,
    playerInitCountAfterNearScroll: null,
    playerInitCountAfterActivation: null,
    activationOnce: null,
    cleanupPass: null,
    layoutStable: null,
    videoLayoutStable: null,
    audioLayoutStable: null,
    inlineVideoPass: null,
    enclosureVideoPass: null,
    enclosureAudioPass: null,
    inlineAudioPreserved: null,
    iframePreserved: null,
    playerTypes: null,
    errors: failures,
  }
  const onPlayerInit = (type, player) => {
    playerInits.push(type)
    const destroy = player.destroy.bind(player)
    let destroyed = false
    player.destroy = (...args) => {
      if (!destroyed) {
        destroyed = true
        playerCleanups.push(type)
      }
      return destroy(...args)
    }
  }

  try {
    restoreMediaSource = stubMediaSourceAssignments()
    if (activeRoot) {
      const previousRoot = activeRoot
      activeRoot = null
      previousRoot.unmount()
    }
    scrollRoot.scrollTop = 0

    report.viewport = `${window.innerWidth}x${window.innerHeight}`
    report.observerSupported = typeof IntersectionObserver === "function"
    activeRoot = createRoot(articleRoot)
    flushSync(() => activeRoot.render(<ReaderMediaFixture onPlayerInit={onPlayerInit} />))
    publishReport(report)

    await waitFor(() => playerInits.includes("inline-video"), "visible inline video initialization")
    report.playerInitCountBeforeScroll = playerInits.length
    report.farMediaDeferred =
      !articleRoot.querySelector('[data-media-case="far-video"] .plyr') &&
      !articleRoot.querySelector('[data-media-case="enclosure-video"] .plyr') &&
      !articleRoot.querySelector('[data-media-case="enclosure-audio"] .plyr')
    const nearCase = articleRoot.querySelector('[data-media-case="near-video"]')
    const nearPlaceholder = nearCase.querySelector(".lazy-plyr-player-placeholder")
    const nearInitialBox = nearPlaceholder?.getBoundingClientRect()
    const nearInitialHeight = nearInitialBox?.height ?? 0
    const nearInitialWidth = nearInitialBox?.width ?? 0
    const nearTop = getRelativeTop(nearCase, scrollRoot)
    scrollRoot.scrollTop = Math.max(0, nearTop - scrollRoot.clientHeight - 200)
    await waitFor(() => playerInits.includes("near-video"), "near-video activation")
    report.playerInitCountAfterNearScroll = playerInits.length
    const nearPlayerElement = nearCase.querySelector(".plyr--video")
    const nearPlayerRect = nearPlayerElement?.getBoundingClientRect()
    const playerFrameRect = nearCase.querySelector(".plyr__video-wrapper")?.getBoundingClientRect()
    report.geometry = {
      placeholderHeight: nearInitialHeight,
      placeholderWidth: nearInitialWidth,
      playerHeight: nearPlayerRect?.height ?? 0,
      playerWidth: nearPlayerRect?.width ?? 0,
      playerFrameHeight: playerFrameRect?.height ?? 0,
      playerFrameWidth: playerFrameRect?.width ?? 0,
      playerTop: nearPlayerRect?.top ?? null,
      scrollRootBottom: scrollRoot.getBoundingClientRect().bottom,
    }
    report.nearMediaActivatedBeforeVisible =
      (nearPlayerRect?.top ?? -Infinity) >= scrollRoot.getBoundingClientRect().bottom
    report.videoLayoutStable = Math.abs(nearInitialHeight - (playerFrameRect?.height ?? 0)) <= 2

    const afterNearCount = playerInits.length
    scrollRoot.scrollTop = 0
    await new Promise(requestAnimationFrame)
    scrollRoot.scrollTop = Math.max(0, nearTop - scrollRoot.clientHeight - 200)
    await new Promise(requestAnimationFrame)
    report.activationOnce = playerInits.length === afterNearCount

    let enclosureAudioPlaceholderHeight = 0
    for (const [type, expected] of [
      ["enclosure-video", ".plyr--video"],
      ["enclosure-audio", ".plyr--audio"],
    ]) {
      const mediaCase = articleRoot.querySelector(`[data-media-case="${CSS.escape(type)}"]`)
      const mediaPlaceholder = mediaCase.querySelector(".lazy-plyr-player-placeholder")
      if (type === "enclosure-audio") {
        enclosureAudioPlaceholderHeight = mediaPlaceholder?.getBoundingClientRect().height ?? 0
      }
      const mediaTop = getRelativeTop(mediaCase, scrollRoot)
      scrollRoot.scrollTop = Math.max(0, mediaTop - scrollRoot.clientHeight - 200)
      await waitFor(() => playerInits.includes(type), `${type} activation`)
      if (!mediaCase.querySelector(expected)) {
        failures.push(`${type} did not create its expected Plyr element`)
      }
      if (type === "enclosure-audio") {
        const audioPlayerHeight =
          mediaCase.querySelector(".plyr--audio")?.getBoundingClientRect().height ?? 0
        report.audioLayoutStable =
          Math.abs(enclosureAudioPlaceholderHeight - audioPlayerHeight) <= 2
        report.audioGeometry = {
          placeholderHeight: enclosureAudioPlaceholderHeight,
          playerHeight: audioPlayerHeight,
        }
      }
    }

    report.playerInitCountAfterActivation = playerInits.length
    report.inlineVideoPass =
      playerInits.filter((type) => type === "inline-video" || type === "near-video").length === 2
    report.enclosureVideoPass = playerInits.includes("enclosure-video")
    report.enclosureAudioPass = playerInits.includes("enclosure-audio")
    report.layoutStable = report.videoLayoutStable && report.audioLayoutStable
    report.inlineAudioPreserved = Boolean(
      articleRoot.querySelector('audio[data-testid="inline-audio"]'),
    )
    report.iframePreserved = Boolean(
      articleRoot.querySelector('iframe[loading="lazy"][title="Existing iframe path"]'),
    )
    report.playerTypes = [...playerInits]
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error))
  } finally {
    try {
      activeRoot?.unmount()
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error))
    } finally {
      activeRoot = null
      try {
        restoreMediaSource()
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error))
      }
    }
    report.cleanupPass = playerCleanups.length === playerInits.length
    report.playerCleanupCount = playerCleanups.length
    report.summary =
      Object.entries(report)
        .filter(
          ([key, value]) =>
            key.endsWith("Pass") ||
            key === "farMediaDeferred" ||
            key === "nearMediaActivatedBeforeVisible" ||
            key === "activationOnce" ||
            key === "layoutStable",
        )
        .every(([, value]) => value === true) && failures.length === 0
        ? "PASS"
        : "FAIL"
    try {
      publishReport(report)
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error))
      report.summary = "FAIL"
      globalThis.__readerMedia01aReport = report
    }
  }
}

runButton.addEventListener("click", () => {
  runButton.disabled = true
  runHarness()
    .finally(() => {
      runButton.disabled = false
    })
    .catch((error) => {
      reportElement.textContent = error instanceof Error ? error.message : String(error)
    })
})

globalThis.runReaderMedia01a = runHarness
