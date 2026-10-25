/* eslint-disable unicorn/consistent-function-scoping, unicorn/prefer-string-raw */

import assert from "node:assert/strict"
import test from "node:test"

import { findInPath, getBrowserVersion, resolveBrowserExecutable } from "./browser-resolver.js"

test("findInPath resolves executable when present in PATH directory", () => {
  const fakeFs = (filePath) => filePath === "/usr/local/bin/google-chrome"
  const result = findInPath("google-chrome", "/usr/bin:/usr/local/bin:/bin", fakeFs, "linux")
  assert.equal(result, "/usr/local/bin/google-chrome")
})

test("findInPath returns null when executable is not in PATH", () => {
  const fakeFs = () => false
  const result = findInPath("chromium-custom", "/usr/bin:/bin", fakeFs, "linux")
  assert.equal(result, null)
})

test("findInPath handles Windows semicolon delimiter and .exe suffix", () => {
  const fakeFs = (filePath) => filePath === "C:\\Tools\\chrome.exe"
  const result = findInPath("chrome", "C:\\Windows;C:\\Tools", fakeFs, "win32")
  assert.equal(result, "C:\\Tools\\chrome.exe")
})

test("resolveBrowserExecutable: CHROME_PATH valid direct path override succeeds", () => {
  const fakeFs = (filePath) => filePath === "/custom/bin/my-chrome"
  const res = resolveBrowserExecutable({
    env: { CHROME_PATH: "/custom/bin/my-chrome" },
    fsExists: fakeFs,
    platform: "linux",
  })
  assert.equal(res.executable, "/custom/bin/my-chrome")
  assert.equal(res.source, "CHROME_PATH_OVERRIDE")
})

test("resolveBrowserExecutable: CHROME_PATH valid command name in PATH succeeds", () => {
  const fakeFs = (filePath) => filePath === "/opt/bin/custom-browser"
  const fakeFind = (cmd, pathEnv) =>
    cmd === "custom-browser" && pathEnv?.includes("/opt/bin") ? "/opt/bin/custom-browser" : null

  const res = resolveBrowserExecutable({
    env: { CHROME_PATH: "custom-browser", PATH: "/opt/bin:/usr/bin" },
    findPath: fakeFind,
    fsExists: fakeFs,
    platform: "linux",
  })
  assert.equal(res.executable, "/opt/bin/custom-browser")
  assert.equal(res.source, "CHROME_PATH_OVERRIDE")
})

test("resolveBrowserExecutable: CHROME_PATH invalid override throws actionable error", () => {
  const fakeFs = () => false
  const fakeFind = () => null

  assert.throws(
    () => {
      resolveBrowserExecutable({
        env: { CHROME_PATH: "/nonexistent/chrome/path" },
        findPath: fakeFind,
        fsExists: fakeFs,
        platform: "linux",
      })
    },
    {
      message: /Configured CHROME_PATH "\/nonexistent\/chrome\/path" was not found/,
    },
  )
})

test("resolveBrowserExecutable: explicit override takes priority over platform defaults", () => {
  // Both default and override exist in fake fs
  const fakeFs = (filePath) =>
    filePath === "/custom/override/chrome" ||
    filePath === "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

  const res = resolveBrowserExecutable({
    env: { CHROME_PATH: "/custom/override/chrome" },
    fsExists: fakeFs,
    platform: "darwin",
  })
  assert.equal(res.executable, "/custom/override/chrome")
  assert.equal(res.source, "CHROME_PATH_OVERRIDE")
})

test("resolveBrowserExecutable: macOS default discovery resolves Google Chrome", () => {
  const fakeFs = (filePath) =>
    filePath === "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

  const res = resolveBrowserExecutable({
    env: {},
    fsExists: fakeFs,
    platform: "darwin",
  })
  assert.equal(res.executable, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
  assert.equal(res.source, "MACOS_APPLICATION_PATH")
})

test("resolveBrowserExecutable: macOS fallback discovery resolves Chromium", () => {
  const fakeFs = (filePath) => filePath === "/Applications/Chromium.app/Contents/MacOS/Chromium"

  const res = resolveBrowserExecutable({
    env: {},
    fsExists: fakeFs,
    platform: "darwin",
  })
  assert.equal(res.executable, "/Applications/Chromium.app/Contents/MacOS/Chromium")
  assert.equal(res.source, "MACOS_APPLICATION_PATH")
})

test("resolveBrowserExecutable: Linux discovery resolves google-chrome via PATH", () => {
  const fakeFind = (cmd) => (cmd === "google-chrome" ? "/usr/bin/google-chrome" : null)

  const res = resolveBrowserExecutable({
    env: { PATH: "/usr/bin" },
    findPath: fakeFind,
    fsExists: () => false,
    platform: "linux",
  })
  assert.equal(res.executable, "/usr/bin/google-chrome")
  assert.equal(res.source, "PATH_LOOKUP")
})

test("resolveBrowserExecutable: Linux fallback resolves chromium via PATH when google-chrome absent", () => {
  const fakeFind = (cmd) => (cmd === "chromium" ? "/usr/bin/chromium" : null)

  const res = resolveBrowserExecutable({
    env: { PATH: "/usr/bin" },
    findPath: fakeFind,
    fsExists: () => false,
    platform: "linux",
  })
  assert.equal(res.executable, "/usr/bin/chromium")
  assert.equal(res.source, "PATH_LOOKUP")
})

test("resolveBrowserExecutable: Linux discovery resolves system path directly", () => {
  const fakeFs = (p) => p === "/snap/bin/chromium"

  const res = resolveBrowserExecutable({
    env: { PATH: "" },
    findPath: () => null,
    fsExists: fakeFs,
    platform: "linux",
  })
  assert.equal(res.executable, "/snap/bin/chromium")
  assert.equal(res.source, "SYSTEM_PATH")
})

test("resolveBrowserExecutable: Windows discovery resolves Program Files Chrome", () => {
  const fakeFs = (p) => p === "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"

  const res = resolveBrowserExecutable({
    env: {},
    findPath: () => null,
    fsExists: fakeFs,
    platform: "win32",
  })
  assert.equal(res.executable, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe")
  assert.equal(res.source, "SYSTEM_PATH")
})

test("resolveBrowserExecutable: no browser found produces actionable error with attempted list", () => {
  assert.throws(
    () => {
      resolveBrowserExecutable({
        env: {},
        findPath: () => null,
        fsExists: () => false,
        platform: "linux",
      })
    },
    (err) => {
      assert.match(err.message, /No compatible Chromium-family browser found/)
      assert.match(err.message, /google-chrome/)
      assert.match(err.message, /chromium/)
      assert.match(err.message, /CHROME_PATH/)
      return true
    },
  )
})

test("getBrowserVersion: parses command output properly", () => {
  const fakeRunner = () => "Google Chrome 130.0.6723.70 \n"
  const version = getBrowserVersion("/usr/bin/google-chrome", fakeRunner)
  assert.equal(version, "Google Chrome 130.0.6723.70")
})

test("getBrowserVersion: handles execution error gracefully", () => {
  const fakeRunner = () => {
    throw new Error("Command failed")
  }
  const version = getBrowserVersion("/bad/chrome", fakeRunner)
  assert.equal(version, "unknown")
})
