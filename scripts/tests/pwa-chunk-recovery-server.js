import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(__dirname, "../..")
const args = process.argv.slice(2)
const option = (name, fallback) => {
  const index = args.indexOf(name)
  return index === -1 ? fallback : args[index + 1]
}

const port = Number(option("--port", "4178"))
const basePath = option("--base", "/")
const initialBuild = option("--initial", "A").toUpperCase()
const basePattern = /^\/(?:[A-Za-z0-9._~-]+\/)*$/

if (!basePattern.test(basePath) || !["A", "B"].includes(initialBuild)) {
  throw new Error("Use --base / or a slash-terminated path and --initial A|B")
}

const state = { build: initialBuild, failProbe: false }

const send = (response, status, contentType, body, extraHeaders = {}) => {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": contentType,
    ...extraHeaders,
  })
  response.end(body)
}

const getIndexHtml = (build) => String.raw`<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>NewsFlux A2C two-build harness</title></head>
  <body>
    <main>
      <div id="root" aria-hidden="true"></div>
      <h1>NewsFlux recovery fixture</h1>
      <p>Served build: <strong id="served-build">${build}</strong></p>
      <p>Boot state: <output id="boot-state">STARTING</output></p>
      <p>Service worker: <output id="worker-state">PENDING</output></p>
      <p>Navigation count: <output id="navigation-count"></output></p>
      <p>Recovery receipt: <output id="recovery-receipt">NOT_RECOVERED</output></p>
      <p>Preservation receipt: <output id="preservation-receipt">PENDING</output></p>
      <p>Runtime audit: <output id="runtime-audit">NOT_RUN</output></p>
      <button id="switch-build" type="button">Switch server to other build and update worker</button>
      <button id="switch-server-only" type="button">Switch server only</button>
      <button id="fail-next-probe" type="button">Fail next recovery network preflight</button>
      <button id="trigger-missing-chunk" type="button">Trigger this build's lazy chunk</button>
      <button id="prepare-sentinels" type="button">Prepare unrelated storage sentinels</button>
      <button id="register-sibling-worker" type="button">Register sibling-scope worker</button>
      <button id="inspect-state" type="button">Inspect storage and worker state</button>
      <pre id="event-log" aria-live="polite"></pre>
    </main>
    <script type="module">
      import { installPwaChunkRecovery } from "${basePath}src/utils/pwa-chunk-recovery.js";

      const basePath = ${JSON.stringify(basePath)};
      const build = ${JSON.stringify(build)};
      const recoveryRequested = new URL(location.href).searchParams.has("__newsflux_recovery");
      const log = (value) => {
        const output = document.querySelector("#event-log");
        output.textContent += value + "\n";
      };
      const count = Number(sessionStorage.getItem("a2c-navigation-count") || "0") + 1;
      sessionStorage.setItem("a2c-navigation-count", String(count));
      document.querySelector("#navigation-count").textContent = String(count);
      document.cookie = "a2c-cookie-sentinel=preserved; path=/; SameSite=Lax";
      if (localStorage.getItem("a2c-local-sentinel") === null) {
        localStorage.setItem("a2c-local-sentinel", "preserved");
      }

      const writeIdbSentinel = async () => {
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open("a2c-unrelated-sentinel", 1);
          request.onupgradeneeded = () => request.result.createObjectStore("sentinels");
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        await new Promise((resolve, reject) => {
          const transaction = db.transaction("sentinels", "readwrite");
          transaction.objectStore("sentinels").put("preserved", "state");
          transaction.oncomplete = resolve;
          transaction.onerror = () => reject(transaction.error);
        });
        db.close();
      };

      const readIdbSentinel = async () => {
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open("a2c-unrelated-sentinel", 1);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        if (!db.objectStoreNames.contains("sentinels")) {
          db.close();
          return null;
        }
        const value = await new Promise((resolve, reject) => {
          const transaction = db.transaction("sentinels", "readonly");
          const request = transaction.objectStore("sentinels").get("state");
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        db.close();
        return value;
      };

      const inspectState = async () => {
        const registrations = await navigator.serviceWorker.getRegistrations();
        const cacheNames = await caches.keys();
        const runtime = await caches.open("runtime-build-assets-v2");
        const runtimeEntries = await runtime.keys();
        const unrelatedCache = await caches.open("unrelated-a2c-sentinel");
        const unrelatedSentinel = await unrelatedCache.match(new URL("/unrelated/sentinel", location.origin));
        const registration = registrations.find((candidate) => candidate.scope === new URL(basePath, location.origin).href);
        const audit = {
          localStorage: localStorage.getItem("a2c-local-sentinel") === "preserved",
          cookie: document.cookie.includes("a2c-cookie-sentinel=preserved"),
          indexedDb: await readIdbSentinel() === "preserved",
          unrelatedCache: Boolean(unrelatedSentinel),
          siblingRuntimePath: runtimeEntries.some((request) => request.url === new URL("/other/assets/sibling.js", location.origin).href),
          staleRuntimeAsset: runtimeEntries.some((request) => request.url === new URL(basePath + "assets/stale-build.js", location.origin).href),
          siblingWorker: registrations.some((candidate) => candidate.scope === new URL("/other/", location.origin).href),
          currentScopeRegistration: Boolean(registration),
          activeState: registration?.active?.state ?? "NONE",
          waitingState: registration?.waiting?.state ?? "NONE",
          cacheNames,
        };
        document.querySelector("#runtime-audit").textContent = JSON.stringify(audit);
        globalThis.__a2cRuntimeAudit = audit;
        return audit;
      };

      installPwaChunkRecovery({
        windowObject: globalThis,
        documentObject: document,
        navigatorObject: navigator,
        cacheStorage: caches,
        fetchImpl: globalThis.fetch.bind(globalThis),
        basePath,
      });

      const boot = async () => {
        await import(new URL(basePath + "assets/entry-" + build.toLowerCase() + ".js", location.href));
        document.querySelector("#boot-state").textContent = "PASS_" + build;
        const registration = await navigator.serviceWorker.register(basePath + "sw.js", { updateViaCache: "none" });
        const updateWorkerState = () => {
          document.querySelector("#worker-state").textContent =
            "controller=" + (navigator.serviceWorker.controller?.scriptURL || "NONE") +
            "; active=" + (registration.active?.state || "NONE") +
            "; waiting=" + (registration.waiting?.state || "NONE");
        };
        navigator.serviceWorker.addEventListener("controllerchange", updateWorkerState);
        registration.addEventListener?.("updatefound", updateWorkerState);
        updateWorkerState();
        globalThis.__a2cRegistration = registration;
        globalThis.__a2cReady = true;
      };

      globalThis.__a2cBuild = build;
      globalThis.__a2cNavigateCount = count;
      globalThis.__a2cReady = false;
      void boot().catch((error) => {
        document.querySelector("#boot-state").textContent = "FAIL_" + error.message;
        log("BOOT_ERROR " + error.stack);
      });

      document.querySelector("#switch-build").addEventListener("click", async () => {
        const other = build === "A" ? "B" : "A";
        await fetch("/__harness__/switch?build=" + other, { method: "POST", cache: "no-store" });
        const registration = globalThis.__a2cRegistration;
        await registration.update();
        for (let attempt = 0; attempt < 60 && !registration.waiting; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        document.querySelector("#worker-state").textContent =
          "server=" + other + "; waiting=" + (registration.waiting?.state || "NO");
        log("SERVER_SWITCHED=" + other + "; WAITING=" + Boolean(registration.waiting));
      });

      document.querySelector("#trigger-missing-chunk").addEventListener("click", async () => {
        sessionStorage.setItem("a2c-before-recovery-count", String(globalThis.__a2cNavigateCount));
        try {
          await import(new URL(basePath + "assets/lazy-" + build.toLowerCase() + ".js", location.href));
          log("LAZY_CHUNK_UNEXPECTEDLY_LOADED");
        } catch (error) {
          const event = new Event("vite:preloadError", { cancelable: true });
          globalThis.dispatchEvent(event);
          log("LAZY_CHUNK_FAILED=" + error.name + "; PRELOAD_PREVENTED=" + event.defaultPrevented);
        }
      });

      document.querySelector("#switch-server-only").addEventListener("click", async () => {
        const other = build === "A" ? "B" : "A";
        await fetch("/__harness__/switch?build=" + other, { method: "POST", cache: "no-store" });
        document.querySelector("#worker-state").textContent = "server=" + other + "; worker update not requested";
        log("SERVER_SWITCHED_WITHOUT_WORKER_UPDATE=" + other);
      });

      document.querySelector("#fail-next-probe").addEventListener("click", async () => {
        await fetch("/__harness__/probe?fail=1", { method: "POST", cache: "no-store" });
        log("NEXT_NETWORK_PREFLIGHT=503");
      });

      document.querySelector("#prepare-sentinels").addEventListener("click", async () => {
        log("SENTINELS_START");
        try {
          const precache = "workbox-precache-v2-" + location.origin + basePath;
          const appShell = await caches.open(precache);
          const shellPresent = Boolean(await appShell.match(new URL(basePath, location.origin)));
          const runtime = await caches.open("runtime-build-assets-v2");
          await runtime.put(new Request(new URL(basePath + "assets/stale-build.js", location.origin)), new Response("old js", { headers: { "Content-Type": "text/javascript" } }));
          await runtime.put(new Request(new URL("/other/assets/sibling.js", location.origin)), new Response("sibling", { headers: { "Content-Type": "text/javascript" } }));
          const unrelated = await caches.open("unrelated-a2c-sentinel");
          await unrelated.put(new Request(new URL("/unrelated/sentinel", location.origin)), new Response("preserved"));
          await writeIdbSentinel();
          log("SENTINELS_READY=" + (await caches.keys()).join(",") + "; PRECACHE_SHELL=" + shellPresent);
        } catch (error) {
          log("SENTINELS_ERROR=" + error.name + ":" + error.message);
        }
      });

      document.querySelector("#register-sibling-worker").addEventListener("click", async () => {
        const registration = await navigator.serviceWorker.register("/other/sw.js", { scope: "/other/" });
        await navigator.serviceWorker.ready;
        globalThis.__a2cSiblingRegistration = registration;
        log("SIBLING_SCOPE=" + registration.scope);
      });

      document.querySelector("#inspect-state").addEventListener("click", async () => {
        try {
          await inspectState();
        } catch (error) {
          document.querySelector("#runtime-audit").textContent = "ERROR_" + error.name + ":" + error.message;
        }
      });

      if (recoveryRequested) {
        document.querySelector("#recovery-receipt").textContent = "FRESH_DOCUMENT_" + build;
        const sibling = await caches.open("unrelated-a2c-sentinel");
        const siblingSentinel = await sibling.match(new URL("/unrelated/sentinel", location.origin));
        const runtime = await caches.open("runtime-build-assets-v2");
        const runtimeEntries = await runtime.keys();
        const preserved = {
          localStorage: localStorage.getItem("a2c-local-sentinel") === "preserved",
          cookie: document.cookie.includes("a2c-cookie-sentinel=preserved"),
          indexedDb: await readIdbSentinel() === "preserved",
          unrelatedCache: Boolean(siblingSentinel),
          siblingRuntimePath: runtimeEntries.some((request) => request.url === new URL("/other/assets/sibling.js", location.origin).href),
          staleRuntimeAssetRemoved: !runtimeEntries.some((request) => request.url === new URL(basePath + "assets/stale-build.js", location.origin).href),
          recoveryNavigationCount: count - Number(sessionStorage.getItem("a2c-before-recovery-count") || count - 1),
          reloadCount: count,
        };
        document.querySelector("#preservation-receipt").textContent = JSON.stringify(preserved);
        globalThis.__a2cRecoveryReceipt = preserved;
        await inspectState();
      }
    </script>
  </body>
</html>`

const getServiceWorker = (build) => String.raw`
const BASE_PATH = ${JSON.stringify(basePath)};
const BUILD = ${JSON.stringify(build)};
const PRECACHE = "workbox-precache-v2-" + self.location.origin + BASE_PATH;
const RUNTIME = "runtime-build-assets-v2";
const scopeUrl = new URL(BASE_PATH, self.location.origin);
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(PRECACHE);
    const response = await fetch(scopeUrl.href, { cache: "no-store" });
    await cache.put(scopeUrl.href, response);
  })());
});
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || !url.pathname.startsWith(BASE_PATH)) return;
  if (request.mode === "navigate") {
    event.respondWith((async () => {
      const cache = await caches.open(PRECACHE);
      return (await cache.match(scopeUrl.href)) || fetch(request);
    })());
    return;
  }
  const relative = url.pathname.slice(BASE_PATH.length);
  if (!/^assets\/.+\.(?:js|css)$/i.test(relative)) return;
  event.respondWith((async () => {
    const cache = await caches.open(RUNTIME);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    const type = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    const valid = response.status === 200 && (url.pathname.endsWith(".js") ? ["text/javascript", "application/javascript"].includes(type) : type === "text/css");
    if (valid) await cache.put(request, response.clone());
    return response;
  })());
});
// Build marker ensures the browser detects a changed worker script.
void BUILD;
`

const getEntry = (build) => `
globalThis.__a2cEntryBuild = ${JSON.stringify(build)};
globalThis.__a2cEntryLoaded = true;
`

const otherWorker = `self.addEventListener("install", (event) => event.waitUntil(caches.open("unrelated-a2c-sentinel").then(() => undefined)));`
const utilitySource = await readFile(path.join(repositoryRoot, "src/utils/pwa-chunk-recovery.js"))

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${port}`)

  if (url.pathname === "/__harness__/switch" && request.method === "POST") {
    const build = url.searchParams.get("build")?.toUpperCase()
    if (!build || !["A", "B"].includes(build)) {
      return send(response, 400, "text/plain", "Invalid build")
    }
    state.build = build
    return send(response, 200, "application/json", JSON.stringify(state))
  }

  if (url.pathname === "/__harness__/probe" && request.method === "POST") {
    state.failProbe = url.searchParams.get("fail") === "1"
    return send(response, 200, "application/json", JSON.stringify(state))
  }

  if (
    url.pathname === `${basePath}__newsflux_recovery_probe__` ||
    url.pathname.startsWith(`${basePath}__newsflux_recovery_probe__/`)
  ) {
    if (state.failProbe) {
      state.failProbe = false
      return send(response, 503, "text/plain", "Probe deliberately unavailable")
    }
    return send(response, 200, "text/html; charset=utf-8", getIndexHtml(state.build))
  }

  if (url.pathname === `${basePath}src/utils/pwa-chunk-recovery.js`) {
    return send(response, 200, "text/javascript; charset=utf-8", utilitySource)
  }

  if (url.pathname === `${basePath}sw.js`) {
    return send(response, 200, "text/javascript; charset=utf-8", getServiceWorker(state.build), {
      "Service-Worker-Allowed": basePath,
    })
  }

  if (url.pathname === "/other/sw.js") {
    return send(response, 200, "text/javascript; charset=utf-8", otherWorker, {
      "Service-Worker-Allowed": "/other/",
    })
  }

  const entryMatch = url.pathname.match(
    new RegExp(
      String.raw`^${basePath.replaceAll(/[.*+?^${}()|[\\]\\]/g, String.raw`\\$&`)}assets/entry-([ab])\.js$`,
      "i",
    ),
  )
  if (entryMatch) {
    const requestedBuild = entryMatch[1].toUpperCase()
    if (requestedBuild !== state.build) {
      return send(response, 200, "text/html; charset=utf-8", getIndexHtml(state.build))
    }
    return send(response, 200, "text/javascript; charset=utf-8", getEntry(requestedBuild))
  }

  const lazyMatch = url.pathname.match(
    new RegExp(
      String.raw`^${basePath.replaceAll(/[.*+?^${}()|[\\]\\]/g, String.raw`\\$&`)}assets/lazy-([ab])\.js$`,
      "i",
    ),
  )
  if (lazyMatch) {
    const requestedBuild = lazyMatch[1].toUpperCase()
    if (requestedBuild !== state.build) {
      // Reproduce the accepted A2B-out-of-scope SPA fallback response.
      return send(response, 200, "text/html; charset=utf-8", getIndexHtml(state.build))
    }
    return send(
      response,
      200,
      "text/javascript; charset=utf-8",
      `export default ${JSON.stringify(requestedBuild)};`,
    )
  }

  if (url.pathname.startsWith(basePath)) {
    return send(response, 200, "text/html; charset=utf-8", getIndexHtml(state.build))
  }

  return send(response, 404, "text/plain", "Not found")
})

server.listen(port, "127.0.0.1", () => {
  console.log(
    `PWA03A2C fixture ${basePath} build ${state.build} at http://127.0.0.1:${port}${basePath}`,
  )
})
