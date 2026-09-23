/**
 * external-plugins.test.js — Row-3 scenario: bundled plugins that are
 * disabled fall back to the project's own installations
 *
 * @license MIT
 * @author Toni Förster
 * @copyright © 2026 Toni Förster
 *
 * Plain Node script — no test framework. Exits non-zero on failure.
 *
 * Fixture: tests/fixtures/external-plugin-project/ declares
 * `@prettier/plugin-xml` and `prettier-plugin-properties` (packages the
 * extension also bundles) in its Prettier config and installs them into
 * the project's node_modules.
 *
 * - Simulating "bundled plugin disabled" (no plugin paths injected): the
 *   project's copies must be resolved and loaded.
 * - Simulating "bundled plugin enabled" (bundled path injected): the
 *   bundled version wins and the declaration is not loaded externally —
 *   while the other, non-injected plugin still resolves from the project
 *   (mixed state, matching the per-syntax injection the client performs).
 *
 * Requires `npm run build`, `npm install --omit=dev` inside
 * prettier.novaextension/, and — on first run — network access to install
 * the fixture's dependencies.
 */

const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const {
  requireBuiltArtifacts,
  createServiceClient,
} = require('./helpers/json-rpc-client.js')

const FIXTURE = path.join(__dirname, 'fixtures', 'external-plugin-project')
const EXT_MODULES = path.join(
  __dirname,
  '..',
  'prettier.novaextension',
  'node_modules',
)
const BUNDLED_XML = path.join(
  EXT_MODULES,
  '@prettier',
  'plugin-xml',
  'src',
  'plugin.js',
)
const BUNDLED_PROPERTIES = path.join(
  EXT_MODULES,
  'prettier-plugin-properties',
  'index.js',
)

let failed = 0
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`)
  if (!ok) {
    failed++
    if (detail !== undefined) {
      console.log(`  → ${JSON.stringify(detail).slice(0, 500)}`)
    }
  }
}

function jsonEqual(value, expected) {
  return JSON.stringify(value) === JSON.stringify(expected)
}

function ensureFixtureInstalled() {
  const installed = (name) =>
    fs.existsSync(path.join(FIXTURE, 'node_modules', name))
  if (installed('@prettier') && installed('prettier-plugin-properties')) return
  console.log('Installing fixture dependencies…')
  execSync('npm install --omit=dev --no-audit --no-fund', {
    cwd: FIXTURE,
    stdio: 'inherit',
    timeout: 120000,
  })
}

function formatParams(file, parser, plugins) {
  return {
    original: fs.readFileSync(path.join(FIXTURE, file), 'utf8'),
    pathForConfig: path.join(FIXTURE, file),
    ignorePath: null,
    options: {
      parser,
      filepath: path.join(FIXTURE, file),
      cursorOffset: 0,
      ...(plugins?.length ? { plugins } : {}),
    },
    withCursor: true,
  }
}

async function runVariant(title, fn) {
  console.log(`\n== ${title} ==`)
  const client = createServiceClient({ cwd: FIXTURE })
  try {
    await client.waitForStart()
    await fn(client)
  } finally {
    await client.kill()
  }
}

async function main() {
  requireBuiltArtifacts()
  ensureFixtureInstalled()

  await runVariant(
    'All bundled plugins disabled → project copies used',
    async (client) => {
      // No injected plugins — what the client sends when both bundled
      // plugins are disabled in the extension settings.
      const xml = await client.requestRaw(
        'format',
        formatParams('test.xml', 'xml'),
      )
      const properties = await client.requestRaw(
        'format',
        formatParams('test.properties', 'dot-properties'),
      )

      check(
        'XML formatted successfully',
        typeof xml.formatted === 'string',
        xml,
      )
      check(
        'Properties formatted successfully',
        typeof properties.formatted === 'string',
        properties,
      )
      check(
        'both project plugins reported as loaded (XML request)',
        jsonEqual(xml.loadedPlugins, [
          '@prettier/plugin-xml',
          'prettier-plugin-properties',
        ]),
        xml.loadedPlugins,
      )
      check(
        'both project plugins reported as loaded (Properties request)',
        jsonEqual(properties.loadedPlugins, [
          '@prettier/plugin-xml',
          'prettier-plugin-properties',
        ]),
        properties.loadedPlugins,
      )
      check(
        'no unresolved / disabled plugins',
        xml.unresolvedPlugins === undefined &&
          xml.disabledPlugins === undefined &&
          properties.unresolvedPlugins === undefined &&
          properties.disabledPlugins === undefined,
        { xml, properties },
      )
    },
  )

  await runVariant(
    'Bundled XML enabled → bundled XML wins, properties stay external',
    async (client) => {
      const xml = await client.requestRaw(
        'format',
        formatParams('test.xml', 'xml', [BUNDLED_XML]),
      )

      check('formatted successfully', typeof xml.formatted === 'string', xml)
      check(
        'bundled XML not reported as external',
        !xml.loadedPlugins?.includes('@prettier/plugin-xml'),
        xml.loadedPlugins,
      )
      check(
        'properties plugin still loaded from project (mixed state)',
        jsonEqual(xml.loadedPlugins, ['prettier-plugin-properties']),
        xml.loadedPlugins,
      )
      check(
        'no unresolved / disabled plugins',
        xml.unresolvedPlugins === undefined &&
          xml.disabledPlugins === undefined,
        xml,
      )
    },
  )

  await runVariant(
    'Bundled properties enabled → bundled properties win, XML stays external',
    async (client) => {
      const properties = await client.requestRaw(
        'format',
        formatParams('test.properties', 'dot-properties', [BUNDLED_PROPERTIES]),
      )

      check(
        'formatted successfully',
        typeof properties.formatted === 'string',
        properties,
      )
      check(
        'bundled properties not reported as external',
        !properties.loadedPlugins?.includes('prettier-plugin-properties'),
        properties.loadedPlugins,
      )
      check(
        'XML plugin still loaded from project (mixed state)',
        jsonEqual(properties.loadedPlugins, ['@prettier/plugin-xml']),
        properties.loadedPlugins,
      )
      check(
        'no unresolved / disabled plugins',
        properties.unresolvedPlugins === undefined &&
          properties.disabledPlugins === undefined,
        properties,
      )
    },
  )

  console.log(
    `\n${failed === 0 ? 'All checks passed.' : `${failed} check(s) failed.`}`,
  )
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
