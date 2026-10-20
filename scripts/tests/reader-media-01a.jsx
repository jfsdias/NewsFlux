/* eslint-disable react-refresh/only-export-components -- This standalone test harness is not a product module. */
import React, { useCallback } from "react"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"

import LazyPlyrPlayer from "@/components/ui/LazyPlyrPlayer"

const VIDEO_GEOMETRY_TOLERANCE_PX = 2
const INTENTIONAL_GEOMETRY_MISMATCH_PX = VIDEO_GEOMETRY_TOLERANCE_PX + 2

const createAudioFixture = () => {
  const sampleRate = 8000
  const sampleCount = 2000
  const dataSize = sampleCount
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)
  const writeAscii = (offset, value) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.codePointAt(index))
    }
  }

  writeAscii(0, "RIFF")
  view.setUint32(4, 36 + dataSize, true)
  writeAscii(8, "WAVE")
  writeAscii(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate, true)
  view.setUint16(32, 1, true)
  view.setUint16(34, 8, true)
  writeAscii(36, "data")
  view.setUint32(40, dataSize, true)
  new Uint8Array(buffer, 44).fill(128)

  const blob = new Blob([buffer], { type: "audio/wav" })
  const src = URL.createObjectURL(blob)

  return {
    src,
    mimeType: blob.type,
    size: blob.size,
    revoke: () => URL.revokeObjectURL(src),
  }
}

const createVideoFixture = async () => {
  // A real 2:1 WebM makes source metadata available while matching the reserved fallback ratio.
  const width = 600
  const height = 300
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext("2d")

  if (!context || typeof canvas.captureStream !== "function" || !globalThis.MediaRecorder) {
    throw new Error("A local canvas MediaRecorder fixture is required for video geometry")
  }

  context.fillStyle = "#18344f"
  context.fillRect(0, 0, width, height)
  context.fillStyle = "#e9b949"
  context.fillRect(0, 0, width / 2, height)

  const mimeType = ["video/webm;codecs=vp8", "video/webm;codecs=vp9", "video/webm"].find(
    (candidate) => MediaRecorder.isTypeSupported(candidate),
  )

  if (!mimeType) {
    throw new Error("No supported local WebM codec is available for video geometry")
  }

  const stream = canvas.captureStream(30)
  const recorder = new MediaRecorder(stream, { mimeType })
  const chunks = []

  try {
    const recordedBlob = new Promise((resolve, reject) => {
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data)
        }
      })
      recorder.addEventListener(
        "error",
        (event) => reject(event.error || new Error("Local video recording failed")),
        { once: true },
      )
      recorder.addEventListener(
        "stop",
        () => resolve(new Blob(chunks, { type: recorder.mimeType })),
        { once: true },
      )
    })

    recorder.start()
    await new Promise((resolve) => setTimeout(resolve, 250))
    if (recorder.state === "recording") {
      recorder.stop()
    }

    const blob = await recordedBlob
    if (blob.size === 0) {
      throw new Error("Local video fixture recording was empty")
    }

    const src = URL.createObjectURL(blob)
    return {
      src,
      mimeType: recorder.mimeType,
      width,
      height,
      size: blob.size,
      revoke: () => URL.revokeObjectURL(src),
    }
  } finally {
    if (recorder.state === "recording") {
      recorder.stop()
    }
    for (const track of stream.getTracks()) {
      track.stop()
    }
  }
}

const isVideoGeometryStable = (placeholderHeight, playerHeight) =>
  Number.isFinite(placeholderHeight) &&
  Number.isFinite(playerHeight) &&
  Math.abs(placeholderHeight - playerHeight) <= VIDEO_GEOMETRY_TOLERANCE_PX

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

const PlayerCase = ({ enclosure, label, onPlayerInit, src, style, type }) => {
  const reportInit = useCallback((player) => onPlayerInit(type, player), [onPlayerInit, type])

  return (
    <div className="media-case" data-media-case={type}>
      <span className="media-case-label">{label}</span>
      <LazyPlyrPlayer enclosure={enclosure} src={src} style={style} onPlayerInit={reportInit} />
    </div>
  )
}

const ReaderMediaFixture = ({ audioFixture, onPlayerInit, videoFixture }) => {
  const enclosureVideo = {
    kind: "video",
    mime_type: videoFixture.mimeType,
    url: videoFixture.src,
  }
  const enclosureAudio = {
    kind: "audio",
    mime_type: audioFixture.mimeType,
    url: audioFixture.src,
  }

  return (
    <article>
      <PlayerCase
        label="Inline video already in view"
        src={videoFixture.src}
        type="inline-video"
        onPlayerInit={onPlayerInit}
      />
      <div aria-hidden="true" className="media-spacer" />
      <PlayerCase
        label="Inline video reached by scrolling"
        src={videoFixture.src}
        type="near-video"
        onPlayerInit={onPlayerInit}
      />
      <div aria-hidden="true" className="media-spacer" />
      <PlayerCase
        enclosure={enclosureVideo}
        label="Enclosure video reached by scrolling"
        src={videoFixture.src}
        style={{ maxWidth: "100%" }}
        type="enclosure-video"
        onPlayerInit={onPlayerInit}
      />
      <div aria-hidden="true" className="media-spacer" />
      <PlayerCase
        enclosure={enclosureAudio}
        label="Enclosure audio reached by scrolling"
        src={audioFixture.src}
        style={{ maxWidth: "400px" }}
        type="enclosure-audio"
        onPlayerInit={onPlayerInit}
      />
      <div aria-hidden="true" className="media-spacer" />
      <PlayerCase
        label="Far inline video remains deferred"
        src={videoFixture.src}
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
}

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
    videoMetadataLoadedPass: report.videoMetadataLoadedPass,
    videoFixtureDimensionsPass: report.videoFixtureDimensionsPass,
    geometryAssertionSensitivityPass: report.geometryAssertionSensitivityPass,
    geometryMismatchProbe: report.geometryMismatchProbe,
    videoFixture: report.videoFixture,
    videoMetadataEvents: report.videoMetadataEvents,
    playerInitTimings: report.playerInitTimings,
    placeholderStyles: report.placeholderStyles,
    geometry: report.geometry,
    audioGeometry: report.audioGeometry,
    errors: report.errors,
    summary: report.summary,
  }
  reportElement.textContent = JSON.stringify(visibleReport, null, 2)
}

const runHarness = async () => {
  const runStartedAt = performance.now()
  const playerInits = []
  const playerCleanups = []
  const playerInitTimings = []
  const metadataEvents = []
  const failures = []
  let videoFixture = null
  let audioFixture = null
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
    videoMetadataLoadedPass: null,
    videoFixtureDimensionsPass: null,
    geometryAssertionSensitivityPass: null,
    playerTypes: null,
    errors: failures,
  }
  const onPlayerInit = (type, player) => {
    playerInits.push(type)
    playerInitTimings.push({ type, elapsedMs: performance.now() - runStartedAt })
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
  const onLoadedMetadata = (event) => {
    if (event.target instanceof HTMLVideoElement) {
      metadataEvents.push({
        mediaCase: event.target.closest("[data-media-case]")?.dataset.mediaCase ?? null,
        readyState: event.target.readyState,
        videoWidth: event.target.videoWidth,
        videoHeight: event.target.videoHeight,
        currentSrc: event.target.currentSrc,
        elapsedMs: performance.now() - runStartedAt,
      })
    }
  }

  try {
    if (activeRoot) {
      const previousRoot = activeRoot
      activeRoot = null
      previousRoot.unmount()
    }
    scrollRoot.scrollTop = 0

    videoFixture = await createVideoFixture()
    audioFixture = createAudioFixture()
    document.addEventListener("loadedmetadata", onLoadedMetadata, true)
    report.viewport = `${window.innerWidth}x${window.innerHeight}`
    report.observerSupported = typeof IntersectionObserver === "function"
    activeRoot = createRoot(articleRoot)
    flushSync(() =>
      activeRoot.render(
        <ReaderMediaFixture
          audioFixture={audioFixture}
          videoFixture={videoFixture}
          onPlayerInit={onPlayerInit}
        />,
      ),
    )
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
    const nearLazyPlayer = nearCase.querySelector(".lazy-plyr-player")
    const getStyleSummary = (element) => {
      if (!element) {
        return null
      }
      const computed = getComputedStyle(element)
      const box = element.getBoundingClientRect()
      return {
        width: box.width,
        height: box.height,
        display: computed.display,
        computedWidth: computed.width,
        computedHeight: computed.height,
        aspectRatio: computed.aspectRatio,
        maxWidth: computed.maxWidth,
        objectFit: computed.objectFit,
      }
    }
    report.placeholderStyles = {
      lazyPlayer: getStyleSummary(nearLazyPlayer),
      placeholder: getStyleSummary(nearPlaceholder),
    }
    const nearTop = getRelativeTop(nearCase, scrollRoot)
    scrollRoot.scrollTop = Math.max(0, nearTop - scrollRoot.clientHeight - 200)
    await waitFor(() => playerInits.includes("near-video"), "near-video activation")
    await waitFor(
      () => metadataEvents.some((event) => event.mediaCase === "near-video"),
      "near-video loadedmetadata",
    )
    report.playerInitCountAfterNearScroll = playerInits.length
    const nearPlayerElement = nearCase.querySelector(".plyr--video")
    const nearVideoElement = nearCase.querySelector("video")
    const nearFrameElement = nearCase.querySelector(".plyr__video-wrapper")
    const nearPlayerRect = nearPlayerElement?.getBoundingClientRect()
    const playerFrameRect = nearFrameElement?.getBoundingClientRect()
    report.geometry = {
      placeholderHeight: nearInitialHeight,
      placeholderWidth: nearInitialWidth,
      playerHeight: nearPlayerRect?.height ?? 0,
      playerWidth: nearPlayerRect?.width ?? 0,
      playerFrameHeight: playerFrameRect?.height ?? 0,
      playerFrameWidth: playerFrameRect?.width ?? 0,
      playerTop: nearPlayerRect?.top ?? null,
      scrollRootBottom: scrollRoot.getBoundingClientRect().bottom,
      playerStyles: getStyleSummary(nearPlayerElement),
      frameStyles: getStyleSummary(nearFrameElement),
      videoStyles: getStyleSummary(nearVideoElement),
      video: {
        src: nearVideoElement?.src ?? null,
        currentSrc: nearVideoElement?.currentSrc ?? null,
        readyState: nearVideoElement?.readyState ?? null,
        videoWidth: nearVideoElement?.videoWidth ?? null,
        videoHeight: nearVideoElement?.videoHeight ?? null,
      },
    }
    report.nearMediaActivatedBeforeVisible =
      (nearPlayerRect?.top ?? -Infinity) >= scrollRoot.getBoundingClientRect().bottom
    report.videoLayoutStable = isVideoGeometryStable(nearInitialHeight, playerFrameRect?.height)
    const originalFrameInlineHeight = nearFrameElement?.style.height ?? ""
    const intentionallyMismatchedFrameHeight =
      (playerFrameRect?.height ?? 0) + INTENTIONAL_GEOMETRY_MISMATCH_PX
    let measuredMismatchedFrameHeight = 0
    try {
      if (nearFrameElement) {
        nearFrameElement.style.height = `${intentionallyMismatchedFrameHeight}px`
        measuredMismatchedFrameHeight = nearFrameElement.getBoundingClientRect().height
      }
    } finally {
      if (nearFrameElement) {
        nearFrameElement.style.height = originalFrameInlineHeight
      }
    }
    report.geometryMismatchProbe = {
      requestedDeltaPx: INTENTIONAL_GEOMETRY_MISMATCH_PX,
      measuredFrameHeight: measuredMismatchedFrameHeight,
      detected: !isVideoGeometryStable(nearInitialHeight, measuredMismatchedFrameHeight),
    }
    report.videoMetadataLoadedPass =
      nearVideoElement?.readyState >= HTMLMediaElement.HAVE_METADATA &&
      metadataEvents.some((event) => event.mediaCase === "near-video")
    report.videoFixtureDimensionsPass =
      nearVideoElement?.videoWidth === videoFixture.width &&
      nearVideoElement?.videoHeight === videoFixture.height
    report.geometryAssertionSensitivityPass = report.geometryMismatchProbe.detected
    report.videoFixture = {
      sourceType: "local canvas MediaRecorder WebM",
      mimeType: videoFixture.mimeType,
      width: videoFixture.width,
      height: videoFixture.height,
      aspectRatio: `${videoFixture.width} / ${videoFixture.height}`,
      size: videoFixture.size,
    }
    report.videoMetadataEvents = metadataEvents
    report.playerInitTimings = playerInitTimings

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
      document.removeEventListener("loadedmetadata", onLoadedMetadata, true)
      if (videoFixture) {
        videoFixture.revoke()
      }
      if (audioFixture) {
        audioFixture.revoke()
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
