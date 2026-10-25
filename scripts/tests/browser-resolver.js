import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

/**
 * Searches directories in PATH for an executable command name.
 *
 * @param {string} command - Name of executable (e.g. "google-chrome").
 * @param {string} [pathEnv] - PATH string (defaults to process.env.PATH).
 * @param {(p: string) => boolean} [fsExists] - File existence check function.
 * @param {string} [platform] - Target platform (defaults to process.platform).
 * @returns {string|null} Resolved absolute path or null if not found.
 */
export function findInPath(
  command,
  pathEnv = process.env.PATH || "",
  fsExists = (p) => fs.existsSync(p),
  platform = process.platform,
) {
  if (!command || !pathEnv) {
    return null
  }

  const delimiter = platform === "win32" ? ";" : ":"
  const dirs = pathEnv.split(delimiter).filter(Boolean)
  const isWindows = platform === "win32"
  const pathModule = isWindows ? path.win32 : path.posix
  const candidates =
    isWindows && !command.toLowerCase().endsWith(".exe") ? [command, `${command}.exe`] : [command]

  for (const dir of dirs) {
    for (const name of candidates) {
      const fullPath = pathModule.join(dir, name)
      try {
        if (fsExists(fullPath)) {
          return fullPath
        }
      } catch {
        // ignore access errors
      }
    }
  }

  return null
}

export const PLATFORM_CANDIDATES = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "google-chrome",
    "chromium",
    "chromium-browser",
  ],
  linux: [
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
  ],
  win32: [
    String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`,
    String.raw`C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`,
    String.raw`C:\Program Files\Microsoft\Edge\Application\msedge.exe`,
    "chrome.exe",
  ],
}

/**
 * Resolves a Chromium-family browser executable across platforms with override support.
 *
 * @param {object} [options]
 * @param {Record<string, string|undefined>} [options.env] - Environment variables.
 * @param {string} [options.platform] - Target OS platform ("darwin", "linux", "win32").
 * @param {(p: string) => boolean} [options.fsExists] - File existence predicate.
 * @param {(cmd: string, pEnv?: string, exists?: (p: string) => boolean, plt?: string) => string|null} [options.findPath]
 * @returns {{ executable: string, source: string, type: "chromium" }}
 */
export function resolveBrowserExecutable(options = {}) {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const fsExists = options.fsExists ?? ((p) => fs.existsSync(p))
  const findPath = options.findPath ?? findInPath

  // 1. Explicit override via CHROME_PATH
  const explicitPath = env.CHROME_PATH?.trim()
  if (explicitPath) {
    const isDirectPath =
      explicitPath.startsWith("/") ||
      explicitPath.startsWith("./") ||
      explicitPath.startsWith("../") ||
      (platform === "win32" && /^[a-zA-Z]:\\/.test(explicitPath))

    if (isDirectPath) {
      if (fsExists(explicitPath)) {
        return {
          executable: explicitPath,
          source: "CHROME_PATH_OVERRIDE",
          type: "chromium",
        }
      }
    } else {
      const fromPath = findPath(explicitPath, env.PATH, fsExists, platform)
      if (fromPath) {
        return {
          executable: fromPath,
          source: "CHROME_PATH_OVERRIDE",
          type: "chromium",
        }
      }
    }

    throw new Error(
      `Configured CHROME_PATH "${explicitPath}" was not found or is not executable on this system.`,
    )
  }

  // 2. Platform-aware discovery
  const candidates = PLATFORM_CANDIDATES[platform] ?? PLATFORM_CANDIDATES.linux
  const attempted = []

  for (const candidate of candidates) {
    attempted.push(candidate)
    const isDirect =
      candidate.startsWith("/") || (platform === "win32" && /^[a-zA-Z]:\\/.test(candidate))

    if (isDirect) {
      if (fsExists(candidate)) {
        return {
          executable: candidate,
          source: platform === "darwin" ? "MACOS_APPLICATION_PATH" : "SYSTEM_PATH",
          type: "chromium",
        }
      }
    } else {
      const resolved = findPath(candidate, env.PATH, fsExists, platform)
      if (resolved) {
        return {
          executable: resolved,
          source: "PATH_LOOKUP",
          type: "chromium",
        }
      }
    }
  }

  throw new Error(
    `No compatible Chromium-family browser found on platform "${platform}".\n` +
      `Attempted discovery mechanisms:\n` +
      `- CHROME_PATH environment variable (unset)\n` +
      `- Platform candidates checked: ${attempted.join(", ")}\n` +
      `- PATH lookup\n` +
      `Please install Google Chrome or Chromium, or set CHROME_PATH to point directly to your executable.`,
  )
}

/**
 * Retrieves the version string of a browser executable.
 *
 * @param {string} executablePath
 * @param {(file: string, args: string[]) => string} [execSyncImpl]
 * @returns {string} Version string or "unknown"
 */
export function getBrowserVersion(executablePath, execSyncImpl) {
  const runner =
    execSyncImpl ??
    ((file, args) =>
      execFileSync(file, args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5000,
      }))

  try {
    const output = runner(executablePath, ["--version"]).trim()
    return output || "unknown"
  } catch {
    return "unknown"
  }
}
