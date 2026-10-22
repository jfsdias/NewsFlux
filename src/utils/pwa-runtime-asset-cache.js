export const RUNTIME_BUILD_ASSET_CACHE_NAME = "runtime-build-assets-v2"

export const runtimeBuildAssetCachePlugin = {
  cacheWillUpdate: ({ request, response }) => {
    if (response?.status !== 200) {
      return null
    }

    const pathname = new URL(request.url).pathname.toLowerCase()
    const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase()

    if (pathname.endsWith(".js")) {
      return ["text/javascript", "application/javascript"].includes(contentType) ? response : null
    }

    if (pathname.endsWith(".css")) {
      return contentType === "text/css" ? response : null
    }

    return null
  },
}
