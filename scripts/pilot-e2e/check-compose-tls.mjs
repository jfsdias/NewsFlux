import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { stdout } from "node:process"
import { setTimeout } from "node:timers/promises"
import https from "node:https"

const ca = await readFile("/certs/ca.crt")
let response
for (let attempt = 0; attempt < 15; attempt += 1) {
  try {
    response = await new Promise((resolve, reject) => {
      const request = https.get(
        "https://newsflux.example/",
        { ca, servername: "newsflux.example", timeout: 5000 },
        (result) => {
          result.resume()
          result.on("end", () => resolve(result))
        },
      )
      request.on("timeout", () => request.destroy(new Error("TLS probe timed out")))
      request.on("error", reject)
    })
    break
  } catch (error) {
    if (!new Set(["ECONNREFUSED", "EAI_AGAIN"]).has(error.code) || attempt === 14) {
      throw error
    }
    await setTimeout(1000)
  }
}

assert.equal(response.statusCode, 200)
stdout.write("TLS_INGRESS_CERTIFICATE_IDENTITY=PASS\n")
