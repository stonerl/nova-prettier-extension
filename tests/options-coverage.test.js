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
 *
 * The plugin option lists (prettier-config.js's loadPluginConfig) are
 * guarded the same way, in both directions: every `prettier.plugins.*`
 * UI key must be declared in the matching PRETTIER_*_PLUGIN_OPTIONS
 * list, and every declared option must have a settings UI key. This
 * would have caught the continuationIndent key that sat under the xml
 * plugin while the option belongs to prettier-plugin-nginx.
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

/**
 * Maps each plugin option list in prettier-options.js to the config key
 * base prettier-config.js actually reads it from — mirroring the 13
 * loadPluginConfig call sites. Kept explicit rather than derived from
 * the export names because of the two sql subgroups.
 */
const PLUGIN_BASES = {
  'prettier.plugins.prettier-plugin-astro': 'PRETTIER_ASTRO_PLUGIN_OPTIONS',
  'prettier.plugins.prettier-plugin-blade': 'PRETTIER_BLADE_PLUGIN_OPTIONS',
  'prettier.plugins.prettier-plugin-liquid': 'PRETTIER_LIQUID_PLUGIN_OPTIONS',
  'prettier.plugins.prettier-plugin-nginx': 'PRETTIER_NGINX_PLUGIN_OPTIONS',
  'prettier.plugins.prettier-plugin-php': 'PRETTIER_PHP_PLUGIN_OPTIONS',
  'prettier.plugins.prettier-plugin-properties':
    'PRETTIER_PROPERTIES_PLUGIN_OPTIONS',
  'prettier.plugins.prettier-plugin-sh': 'PRETTIER_SH_PLUGIN_OPTIONS',
  'prettier.plugins.prettier-plugin-sql.sql-formatter':
    'PRETTIER_SQL_PLUGIN_SQL_FORMATTER_OPTIONS',
  'prettier.plugins.prettier-plugin-sql.node-sql-parser':
    'PRETTIER_SQL_PLUGIN_NODE_SQL_PARSER_OPTIONS',
  'prettier.plugins.prettier-plugin-tailwind':
    'PRETTIER_TAILWIND_PLUGIN_OPTIONS',
  'prettier.plugins.prettier-plugin-toml': 'PRETTIER_TOML_PLUGIN_OPTIONS',
  'prettier.plugins.prettier-plugin-twig': 'PRETTIER_TWIG_PLUGIN_OPTIONS',
  'prettier.plugins.prettier-plugin-xml': 'PRETTIER_XML_PLUGIN_OPTIONS',
}

// Settings that live under prettier.plugins.* but are not plugin
// passthrough options: the SQL formatter routing setting is read
// directly in formatter.js, `enabled` toggles plugin loading, and
// `section` entries are UI headers.
const EXEMPT_PLUGIN_OPTIONS = new Set(['formatter', 'enabled', 'section'])

/**
 * Collects the plugin option names exposed in the settings UI, grouped
 * by config key base. Only direct single-segment children count; the
 * tailwind `syntaxes.*` toggles nest under their own key.
 */
function collectPluginUiOptions(unifiedConfig, uiOptions) {
  if (Array.isArray(unifiedConfig)) {
    for (const entry of unifiedConfig) {
      collectPluginUiOptions(entry, uiOptions)
    }
    return uiOptions
  }
  if (typeof unifiedConfig !== 'object' || unifiedConfig === null) {
    return uiOptions
  }

  const key = unifiedConfig.key
  if (typeof key === 'string' && key.startsWith('prettier.plugins.')) {
    for (const base of uiOptions.keys()) {
      if (key.startsWith(`${base}.`)) {
        const option = key.slice(base.length + 1)
        if (
          option &&
          !option.includes('.') &&
          !EXEMPT_PLUGIN_OPTIONS.has(option) &&
          unifiedConfig.type !== 'section'
        ) {
          uiOptions.get(base).add(option)
        }
        break
      }
    }
  }

  for (const value of Object.values(unifiedConfig)) {
    collectPluginUiOptions(value, uiOptions)
  }
  return uiOptions
}

function pluginCoverage() {
  console.log('\n== every plugin option is wired in both directions ==')

  const unifiedConfig = JSON.parse(fs.readFileSync(UNIFIED_CONFIG, 'utf8'))
  const pluginOptions = require(path.join(SRC_DIR, 'prettier-options.js'))

  // The trap-closer: a new plugin option list must land in PLUGIN_BASES
  // too, or it would ship unguarded — how the continuationIndent drift
  // survived for so long.
  const mappedExports = new Set(Object.values(PLUGIN_BASES))
  const unaccounted = Object.keys(pluginOptions).filter(
    (name) => name !== 'PRETTIER_OPTIONS' && !mappedExports.has(name),
  )
  check(
    'every PRETTIER_*_PLUGIN_OPTIONS export is mapped to a config base',
    unaccounted.length === 0,
    unaccounted,
  )
  const stale = [...mappedExports].filter((name) => !(name in pluginOptions))
  check('PLUGIN_BASES maps only existing exports', stale.length === 0, stale)

  const uiOptions = collectPluginUiOptions(
    unifiedConfig,
    new Map([...Object.keys(PLUGIN_BASES)].map((base) => [base, new Set()])),
  )

  for (const [base, exportName] of Object.entries(PLUGIN_BASES)) {
    const declared = pluginOptions[exportName] || []
    const exposed = uiOptions.get(base)

    const dead = [...exposed].filter((option) => !declared.includes(option))
    check(
      `no exposed setting is missing from ${exportName} (dead settings)`,
      dead.length === 0,
      dead,
    )

    const unwired = declared.filter((option) => !exposed.has(option))
    check(
      `no declared option lacks a settings UI (${base})`,
      unwired.length === 0,
      unwired,
    )
  }

  check(
    'nginx continuationIndent stays wired (was once a dead xml setting)',
    uiOptions
      .get('prettier.plugins.prettier-plugin-nginx')
      .has('continuationIndent') &&
      (pluginOptions.PRETTIER_NGINX_PLUGIN_OPTIONS || []).includes(
        'continuationIndent',
      ),
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
  pluginCoverage()
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
