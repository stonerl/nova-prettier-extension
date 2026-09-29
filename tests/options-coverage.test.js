/**
 * options-coverage.test.js — Guard against dead or unwired Prettier
 * option settings
 *
 * @license MIT
 * @author Toni Förster
 * @copyright © 2026 Toni Förster
 *
 * Plain Node script — no test framework. Exits non-zero on failure.
 *
 * Every `prettier.default-config.*` option exposed in the settings UI
 * must appear in PRETTIER_OPTIONS (prettier-options.js) so that
 * getDefaultConfig() actually reads it into the format request. A
 * mismatch means a setting users can toggle does nothing — e.g.
 * checkIgnorePragma once shipped in the UI without ever reaching the
 * format request.
 *
 * Also asserts that the deprecated jsxBracketSameLine stays unwired,
 * and that the deferred experimental options remain absent until the
 * bundled Prettier version supports them.
 */

const path = require('path')
const fs = require('fs')

const SRC_DIR = fs.realpathSync(
  process.env.OPTIONS_COVERAGE_SRC ||
    path.join(__dirname, '..', 'src', 'Scripts'),
)
const UNIFIED_CONFIG = path.join(__dirname, '..', 'src', 'unifiedConfig.json')

let failed = 0
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`)
  if (!ok) {
    failed++
    if (detail !== undefined) {
      console.log(` → ${JSON.stringify(detail, null, 2).slice(0, 800)}`)
    }
  }
}

/**
 * Collects the option names exposed under prettier.default-config.*,
 * recursing through section wrappers (type: "section" entries carry the
 * real options in their children and are not options themselves).
 */
function collectDefaultConfigKeys(node, keys = new Set()) {
  if (Array.isArray(node)) {
    for (const entry of node) collectDefaultConfigKeys(entry, keys)
    return keys
  }
  if (typeof node !== 'object' || node === null) return keys

  const key = node.key
  if (typeof key === 'string' && key.startsWith('prettier.default-config.')) {
    const option = key.slice('prettier.default-config.'.length)
    if (node.type !== 'section' && option) keys.add(option)
  }

  for (const value of Object.values(node)) collectDefaultConfigKeys(value, keys)
  return keys
}

function loadModules() {
  const unifiedConfig = JSON.parse(fs.readFileSync(UNIFIED_CONFIG, 'utf8'))
  // prettier-options.js is a plain data module — loads without nova.
  const { PRETTIER_OPTIONS } = require(
    path.join(SRC_DIR, 'prettier-options.js'),
  )
  return { unifiedConfig, prettierOptions: new Set(PRETTIER_OPTIONS) }
}

function coverage() {
  console.log('\n== every exposed option is wired into format requests ==')

  const { unifiedConfig, prettierOptions } = loadModules()
  const exposed = collectDefaultConfigKeys(unifiedConfig)

  check(
    'the config exposes a sensible number of options',
    exposed.size >= 20 && exposed.size <= 30,
    exposed.size,
  )

  const dead = [...exposed].filter((key) => !prettierOptions.has(key))
  check(
    'no exposed setting is missing from PRETTIER_OPTIONS (dead settings)',
    dead.length === 0,
    dead,
  )

  const unwired = [...prettierOptions].filter((key) => !exposed.has(key))
  check(
    'no wired option lacks a settings UI (unwired options)',
    unwired.length === 0,
    unwired,
  )

  check(
    'checkIgnorePragma is wired (was once a dead setting)',
    prettierOptions.has('checkIgnorePragma') &&
      exposed.has('checkIgnorePragma'),
  )
}

function deprecatedAndDeferred() {
  console.log(
    '\n== deprecated options stay out, deferred ones stay deferred ==',
  )

  const { prettierOptions } = loadModules()

  check(
    'deprecated jsxBracketSameLine is not wired',
    !prettierOptions.has('jsxBracketSameLine'),
  )

  // Deferred on purpose: experimental options are deliberately not
  // exposed — both are supported by the pinned Prettier (3.9.9 declares
  // experimentalOperatorPosition; the Java plugin also implements it).
  // Flip these when wiring them.
  const deferred = ['experimentalTernaries', 'experimentalOperatorPosition']
  check(
    'deferred experimental options stay unwired until deliberately added',
    deferred.every((key) => !prettierOptions.has(key)),
    deferred.filter((key) => prettierOptions.has(key)),
  )
}

async function main() {
  coverage()
  deprecatedAndDeferred()

  console.log(
    `\n${failed === 0 ? 'All checks passed.' : `${failed} check(s) failed.`}`,
  )
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
