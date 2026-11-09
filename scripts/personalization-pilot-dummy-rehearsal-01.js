import { mkdirSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import prettier from "prettier"

import { runDummyRehearsalFromFrozenFixtures } from "./tests/personalization-pilot-dummy-rehearsal-01.js"

const outputDirectory = new URL("tests/fixtures/", import.meta.url)
const reportDirectory = new URL("tests/reports/", import.meta.url)
const writeArtifacts = process.argv.slice(2)
const formatJson = async (artifact, fileUrl) => {
  const filepath = fileURLToPath(fileUrl)
  const config = await prettier.resolveConfig(filepath)
  return prettier.format(JSON.stringify(artifact), { ...config, filepath })
}

if (
  writeArtifacts.some((argument) => argument !== "--write-artifacts") ||
  writeArtifacts.length > 1
) {
  process.stderr.write(
    "USAGE: node scripts/personalization-pilot-dummy-rehearsal-01.js [--write-artifacts]\n",
  )
  process.exitCode = 2
} else {
  try {
    const rehearsal = runDummyRehearsalFromFrozenFixtures()
    process.stdout.write(
      await formatJson(
        rehearsal.report,
        new URL("personalization-pilot-dummy-rehearsal-01.json", reportDirectory),
      ),
    )

    if (writeArtifacts[0] === "--write-artifacts") {
      mkdirSync(fileURLToPath(reportDirectory), { recursive: true })
      const artifacts = [
        [
          "personalization-pilot-dummy-pre-recruitment-manifest-01.json",
          rehearsal.preRecruitmentManifest,
        ],
        [
          "personalization-pilot-dummy-session-receipts-01.json",
          { fixtureKind: "SYNTHETIC_ONLY", sessionManifests: rehearsal.sessionManifests },
        ],
        ["personalization-pilot-dummy-export-01.json", rehearsal.exportDocument],
      ]
      for (const [filename, artifact] of artifacts) {
        const fileUrl = new URL(filename, outputDirectory)
        writeFileSync(fileUrl, await formatJson(artifact, fileUrl))
      }
      const reportFileUrl = new URL(
        "personalization-pilot-dummy-rehearsal-01.json",
        reportDirectory,
      )
      writeFileSync(reportFileUrl, await formatJson(rehearsal.report, reportFileUrl))
    }
  } catch (error) {
    const code = typeof error?.code === "string" ? error.code : "REHEARSAL_FAILED"
    process.stderr.write(`${code}\n`)
    process.exitCode = 1
  }
}
