const EXPECTED_PACKAGE_SCRIPTS = {
  lint: "eslint",
  "format:check": "prettier --check .",
  "test:src": 'node --test "src/**/*.test.js"',
  "test:scripts": 'node --test "scripts/*.test.js"',
  test: "pnpm run test:src && pnpm run test:scripts",
  build: "vite build",
  "knip:check": "node scripts/check-knip-baseline.js",
  "test:e2e": "pnpm run build && node scripts/run-verified-e2e.js",
  "test:e2e:run": "node scripts/run-verified-e2e.js",
  "test:e2e:stability": "pnpm run build && node scripts/run-e2e-stability.js",
}

const normalizeCommand = (command) =>
  typeof command === "string" ? command.trim().replaceAll(/\s+/g, " ") : null

const validatePackageScripts = (scripts) => {
  if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) {
    return ["package scripts must be an object"]
  }

  return Object.entries(EXPECTED_PACKAGE_SCRIPTS).flatMap(([name, expected]) => {
    const actual = normalizeCommand(scripts[name])
    return actual === expected
      ? []
      : [`${name}: expected effective command "${expected}", got ${String(actual)}`]
  })
}

export default validatePackageScripts
