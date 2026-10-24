import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import zlib from "node:zlib"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const publicDir = path.join(repoRoot, "public")
const viteBin = path.join(repoRoot, "node_modules", ".bin", "vite")

const paethPredictor = (a, b, c) => {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) {
    return a
  }
  if (pb <= pc) {
    return b
  }
  return c
}

const parsePngMetadataAndSafeZone = (filePath, backgroundRgb = [33, 33, 34]) => {
  const buf = readFileSync(filePath)
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  assert.equal(buf.subarray(0, 8).equals(pngSignature), true, `${filePath} must be a valid PNG`)

  const width = buf.readUInt32BE(16)
  const height = buf.readUInt32BE(20)
  const bitDepth = buf[24]
  const colorType = buf[25]
  assert.equal(bitDepth, 8, `${filePath} must use 8-bit depth`)

  const idatChunks = []
  let offset = 8
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset)
    const type = buf.subarray(offset + 4, offset + 8).toString("ascii")
    if (type === "IDAT") {
      idatChunks.push(buf.subarray(offset + 8, offset + 8 + length))
    }
    offset += 12 + length
  }

  const decompressed = zlib.inflateSync(Buffer.concat(idatChunks))
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0
  assert.ok(channels >= 3, `${filePath} must be RGB or RGBA`)

  const stride = width * channels
  const recon = Buffer.alloc(height * stride)

  for (let y = 0; y < height; y += 1) {
    const filterType = decompressed[y * (stride + 1)]
    const rowStart = y * (stride + 1) + 1
    const reconRowStart = y * stride
    for (let x = 0; x < stride; x += 1) {
      const rawByte = decompressed[rowStart + x]
      const left = x >= channels ? recon[reconRowStart + x - channels] : 0
      const up = y > 0 ? recon[reconRowStart - stride + x] : 0
      const upLeft = y > 0 && x >= channels ? recon[reconRowStart - stride + x - channels] : 0
      let val = rawByte
      switch (filterType) {
        case 1: {
          val = (rawByte + left) & 0xff
          break
        }
        case 2: {
          val = (rawByte + up) & 0xff
          break
        }
        case 3: {
          val = (rawByte + Math.floor((left + up) / 2)) & 0xff
          break
        }
        case 4: {
          val = (rawByte + paethPredictor(left, up, upLeft)) & 0xff
          break
        }
        default: {
          break
        }
      }
      recon[reconRowStart + x] = val
    }
  }

  const cx = (width - 1) / 2
  const cy = (height - 1) / 2
  let maxRadius = 0
  let fgPixels = 0

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * stride + x * channels
      const r = recon[idx]
      const g = recon[idx + 1]
      const b = recon[idx + 2]
      const diff =
        Math.abs(r - backgroundRgb[0]) +
        Math.abs(g - backgroundRgb[1]) +
        Math.abs(b - backgroundRgb[2])
      if (diff > 18) {
        fgPixels += 1
        const dist = Math.hypot(x - cx, y - cy)
        if (dist > maxRadius) {
          maxRadius = dist
        }
      }
    }
  }

  return {
    width,
    height,
    fgPixels,
    maxRadius,
    maxRadiusRatio: maxRadius / width,
    byteSize: buf.length,
  }
}

test("PWA-01A icon assets exist, match declared dimensions, obey <=100 KiB budget, and satisfy W3C maskable 40% safe-zone radius", () => {
  const requiredIcons = [
    { file: "logo192.png", width: 192, height: 192, maskable: false },
    { file: "logo512.png", width: 512, height: 512, maskable: false },
    { file: "apple-touch-icon.png", width: 180, height: 180, maskable: false },
    { file: "maskable-icon-192.png", width: 192, height: 192, maskable: true },
    { file: "maskable-icon-512.png", width: 512, height: 512, maskable: true },
  ]

  for (const spec of requiredIcons) {
    const fullPath = path.join(publicDir, spec.file)
    assert.equal(existsSync(fullPath), true, `Missing public/${spec.file}`)
    const stats = statSync(fullPath)
    assert.ok(stats.size <= 100 * 1024, `${spec.file} exceeds 100 KiB budget (${stats.size} bytes)`)

    const meta = parsePngMetadataAndSafeZone(fullPath)
    assert.equal(meta.width, spec.width, `${spec.file} width mismatch`)
    assert.equal(meta.height, spec.height, `${spec.file} height mismatch`)
    assert.ok(meta.fgPixels > 100, `${spec.file} must contain visible foreground artwork`)

    if (spec.maskable) {
      assert.ok(
        meta.maxRadiusRatio <= 0.38,
        `${spec.file} foreground radius ratio ${meta.maxRadiusRatio.toFixed(4)} must stay safely inside the 0.40 W3C maskable safe-zone circle`,
      )
    }
  }
})

test("PWA-01A index.html declares iOS/iPadOS standalone metadata and 180x180 apple-touch-icon", () => {
  const html = readFileSync(path.join(repoRoot, "index.html"), "utf8")
  assert.match(html, /<meta\s+[^>]*name="apple-mobile-web-app-capable"[^>]*content="yes"/i)
  assert.match(html, /<meta\s+[^>]*name="apple-mobile-web-app-title"[^>]*content="NewsFlux"/i)
  assert.match(html, /<meta\s+[^>]*name="application-name"[^>]*content="NewsFlux"/i)
  assert.match(html, /<link\s+[^>]*rel="apple-touch-icon"[^>]*sizes="180x180"/i)
  assert.match(html, /<link\s+[^>]*rel="apple-touch-icon"[^>]*href="\/apple-touch-icon\.png"/i)
})

test("PWA-01A root and non-root builds emit valid manifest id, start_url, scope, separated any/maskable icons, and service worker", () => {
  execFileSync(process.execPath, [path.join(repoRoot, "src/scripts/version-info.js")], {
    cwd: repoRoot,
    stdio: "pipe",
  })

  for (const basePath of ["/", "/newsflux/"]) {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "newsflux-pwa01a-build-"))
    try {
      execFileSync(viteBin, ["build", "--outDir", outDir], {
        cwd: repoRoot,
        env: {
          ...process.env,
          VITE_BASE_PATH: basePath,
        },
        stdio: "pipe",
      })

      const manifestPath = path.join(outDir, "manifest.webmanifest")
      assert.equal(existsSync(manifestPath), true, `Missing manifest.webmanifest for ${basePath}`)
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))

      assert.equal(manifest.name, "NewsFlux")
      assert.equal(manifest.short_name, "NewsFlux")
      assert.equal(manifest.display, "standalone")
      assert.equal(manifest.id, basePath)
      assert.equal(manifest.start_url, basePath)
      assert.equal(manifest.scope, basePath)
      assert.equal(manifest.theme_color, "#0B0D10")
      assert.equal(manifest.background_color, "#0B0D10")

      const anyIcons = manifest.icons.filter((icon) => icon.purpose === "any")
      const maskableIcons = manifest.icons.filter((icon) => icon.purpose === "maskable")
      const combinedPurposeIcons = manifest.icons.filter(
        (icon) => typeof icon.purpose === "string" && icon.purpose.includes(" "),
      )

      assert.equal(
        combinedPurposeIcons.length,
        0,
        "No manifest icon may combine 'any maskable' in a single entry",
      )
      assert.ok(anyIcons.some((icon) => icon.sizes === "192x192" && icon.src === "logo192.png"))
      assert.ok(anyIcons.some((icon) => icon.sizes === "512x512" && icon.src === "logo512.png"))
      assert.ok(
        maskableIcons.some(
          (icon) => icon.sizes === "192x192" && icon.src === "maskable-icon-192.png",
        ),
      )
      assert.ok(
        maskableIcons.some(
          (icon) => icon.sizes === "512x512" && icon.src === "maskable-icon-512.png",
        ),
      )

      const builtHtml = readFileSync(path.join(outDir, "index.html"), "utf8")
      assert.ok(
        builtHtml.includes(`href="${basePath}manifest.webmanifest"`),
        `Built index.html must link ${basePath}manifest.webmanifest`,
      )
      assert.ok(
        builtHtml.includes(`href="${basePath}apple-touch-icon.png"`),
        `Built index.html must link ${basePath}apple-touch-icon.png`,
      )
      assert.equal(existsSync(path.join(outDir, "sw.js")), true)
    } finally {
      rmSync(outDir, { recursive: true, force: true })
    }
  }
})
