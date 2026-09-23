/**
 * service-smoke.test.js — Smoke tests for the Prettier service's
 * config-plugin handling (bundled merge + native passthrough modes)
 *
 * @license MIT
 * @author Toni Förster
 * @copyright © 2026 Toni Förster
 *
 * Plain Node script — no test framework. Exits non-zero on failure.
 *
 * Requires `npm run build` and `npm install --omit=dev` inside
 * prettier.novaextension/ (see tests/helpers/json-rpc-client.js).
 *
 * Fixtures (tests/fixtures/):
 * - mock-project/         – declares bundled, resolvable, unresolvable,
 *                           load-crashing and runtime-crashing plugins
 * - mock-project-native/  – resolvable + runtime-crashing plugins (native mode)
 * - mock-project-healthy/ – external plugins incl. a cursor-crashing one
 *                           (native mode, exercises the cursorless retry)
 *
 * `node_modules` symlinks into `deps/` are created on demand — the
 * handmade plugins are committed, no network install needed.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  requireBuiltArtifacts,
  createServiceClient,
} = require('./helpers/json-rpc-client.js')

const FIXTURES = path.join(__dirname, 'fixtures')
const MOCK_PROJECT = path.join(FIXTURES, 'mock-project')
const MOCK_NATIVE = path.join(FIXTURES, 'mock-project-native')
const MOCK_HEALTHY = path.join(FIXTURES, 'mock-project-healthy')
const EXT_MODULES = path.join(
  __dirname,
  '..',
  'prettier.novaextension',
  'node_modules',
)

let failed = 0
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`)
  if (!ok) {
    failed++
    if (detail !== undefined) {
      console.log(` → ${JSON.stringify(detail).slice(0, 500)}`)
    }
  }
}

function jsonEqual(value, expected) {
  return JSON.stringify(value) === JSON.stringify(expected)
}

/**
 * Link `deps/` as `node_modules` so Node's resolution finds the handmade
 * plugins. Idempotent; the symlink is never committed.
 */
function ensureNodeModulesSymlink(fixtureDir, linkTarget) {
  const link = path.join(fixtureDir, 'node_modules')
  const stats = fs.lstatSync(link, { throwIfNoEntry: false })
  if (stats?.isSymbolicLink()) {
    if (fs.readlinkSync(link) === linkTarget) return
    fs.unlinkSync(link)
  } else if (stats) {
    fs.rmSync(link, { recursive: true })
  }
  fs.symlinkSync(linkTarget, link, 'dir')
}

async function bundledSuite() {
  console.log('\n== Bundled mode: merge, classification, isolation ==')
  ensureNodeModulesSymlink(MOCK_PROJECT, 'deps')

  const client = createServiceClient({ cwd: MOCK_PROJECT })
  try {
    await client.waitForStart()

    // The client injects bundled plugin paths (simulating enabled bundled
    // plugins for a JSON document).
    const result = await client.requestRaw('format', {
      original: '{"a": 1}\n',
      pathForConfig: path.join(MOCK_PROJECT, 'file.json'),
      ignorePath: null,
      options: {
        parser: 'json',
        filepath: path.join(MOCK_PROJECT, 'file.json'),
        cursorOffset: 0,
        plugins: [
          path.join(EXT_MODULES, 'prettier-plugin-ejs', 'index.js'),
          path.join(
            EXT_MODULES,
            'prettier-plugin-tailwindcss',
            'dist',
            'index.mjs',
          ),
        ],
      },
      withCursor: true,
    })

    check(
      'formatted output correct',
      result.formatted === '{ "a": 1 }\n',
      result,
    )
    check(
      'loadedPlugins == [my-esm-plugin, runtime-crashy]',
      jsonEqual(result.loadedPlugins, ['my-esm-plugin', 'runtime-crashy']),
      result.loadedPlugins,
    )
    check(
      'unresolvedPlugins == [no-such-plugin-x, no-such-tuple-plugin]',
      jsonEqual(result.unresolvedPlugins, [
        'no-such-plugin-x',
        'no-such-tuple-plugin',
      ]),
      result.unresolvedPlugins,
    )
    check(
      'config file path reported for unresolved plugins',
      typeof result.configFile === 'string' &&
        result.configFile.endsWith('.prettierrc.json'),
      result.configFile,
    )
    check(
      'disabledPlugins == [crashy-plugin, runtime-crashy]',
      jsonEqual(result.disabledPlugins, ['crashy-plugin', 'runtime-crashy']),
      result.disabledPlugins,
    )
    check(
      'cursor dropped after recovery attempts (client falls back)',
      result.cursorOffset === undefined,
      result.cursorOffset,
    )

    // Bundled-wins: both declared bundled plugins must NOT appear in the
    // report — they were replaced by the injected bundled paths.
    check(
      'bundled declarations not reported as external',
      !result.loadedPlugins?.includes('prettier-plugin-ejs') &&
        !result.loadedPlugins?.includes('prettier-plugin-tailwindcss'),
      result.loadedPlugins,
    )
  } finally {
    await client.kill()
  }
}

async function nativeSuite() {
  console.log(
    '\n== Native mode (explicit path / project Prettier): resolve-or-passthrough ==',
  )
  ensureNodeModulesSymlink(MOCK_NATIVE, '../mock-project/deps')
  ensureNodeModulesSymlink(MOCK_HEALTHY, '../mock-project/deps')

  const client = createServiceClient({ cwd: MOCK_NATIVE })
  try {
    await client.waitForStart()

    const formatOptions = (project) => ({
      original: '{"a": 1}\n',
      pathForConfig: path.join(project, 'file.json'),
      ignorePath: null,
      options: {
        parser: 'json',
        filepath: path.join(project, 'file.json'),
        cursorOffset: 0,
      },
      withCursor: true,
    })

    // 1) Unresolvable declaration → passthrough → Prettier's native
    //    resolution error. No retry, no notices.
    const mixed = await client.requestRaw('format', formatOptions(MOCK_PROJECT))
    check(
      'unresolvable passthrough → native resolve error',
      typeof mixed.error?.message === 'string' &&
        mixed.error.message.includes(
          "Cannot find package 'prettier-plugin-ejs'",
        ),
      mixed.error?.message,
    )
    check(
      'no report fields injected on native error',
      mixed.loadedPlugins === undefined &&
        mixed.unresolvedPlugins === undefined &&
        mixed.disabledPlugins === undefined,
      mixed,
    )

    // 2) Resolvable runtime-crashing plugin → native error surfaces.
    const crashy = await client.requestRaw('format', formatOptions(MOCK_NATIVE))
    check(
      'runtime crasher → native error surfaced',
      typeof crashy.error?.message === 'string' &&
        crashy.error.message.includes('runtime boom'),
      crashy.error?.message,
    )
    check(
      'no retry / no notices for native runtime crash',
      crashy.disabledPlugins === undefined &&
        crashy.unresolvedPlugins === undefined,
      crashy,
    )

    // 3) Repeat request — config/plugin caches stay clean after errors.
    const again = await client.requestRaw('format', formatOptions(MOCK_NATIVE))
    check(
      'repeat request consistent after errors',
      typeof again.error?.message === 'string' &&
        again.error.message.includes('runtime boom'),
      again.error?.message,
    )

    // 4) Healthy project → success, externals reported as loaded. The
    //    fixture also declares `cursor-crashy`, whose locStart() throws —
    //    so every cursor-tracked format crashes and the service must
    //    retry once without cursor tracking.
    const healthy = await client.requestRaw(
      'format',
      formatOptions(MOCK_HEALTHY),
    )
    check(
      'cursor-mapping crash retried without cursor → formatted',
      healthy.formatted === '{\n  "a": 1\n}\n',
      healthy,
    )
    check(
      'cursor offset dropped after cursor-mapping crash',
      healthy.cursorOffset === undefined,
      healthy.cursorOffset,
    )
    check(
      'loadedPlugins == [my-esm-plugin, cursor-crashy]',
      jsonEqual(healthy.loadedPlugins, ['my-esm-plugin', 'cursor-crashy']),
      healthy.loadedPlugins,
    )
    // The healthy fixture declares the plugin in tuple form
    // `["my-esm-plugin", {}]` — tuple specifiers must classify, resolve
    // and load like plain strings, with the options entry preserved.
    check(
      'tuple-form declaration resolved from tuple options',
      healthy.configFile === undefined &&
        healthy.unresolvedPlugins === undefined,
      healthy,
    )
  } finally {
    await client.kill()
  }
}

async function configlessSuite() {
  console.log('\n== Config-less project: resolveConfig null must not crash ==')
  // A fixture under tests/ inherits the repo root .prettierrc via
  // Prettier's directory walk-up, so the null-config case can only be
  // reproduced in a directory outside the repository.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prettier-configless-'))
  try {
    fs.writeFileSync(path.join(tmpDir, 'file.json'), '{"a": 1}\n')

    const formatParams = (plugins) => ({
      original: '{"a": 1}\n',
      pathForConfig: path.join(tmpDir, 'file.json'),
      ignorePath: null,
      options: {
        parser: 'json',
        filepath: path.join(tmpDir, 'file.json'),
        cursorOffset: 0,
        ...(plugins?.length ? { plugins } : {}),
      },
      withCursor: true,
    })

    const client = createServiceClient({ cwd: tmpDir })
    try {
      await client.waitForStart()

      // Bundled mode: bundled plugins injected + no config anywhere above
      const bundled = await client.requestRaw(
        'format',
        formatParams([
          path.join(EXT_MODULES, 'prettier-plugin-ejs', 'index.js'),
        ]),
      )
      check(
        'bundled mode: formats without a config file',
        bundled.formatted === '{ "a": 1 }\n',
        bundled,
      )
      check(
        'bundled mode: no error, no report fields',
        bundled.error === undefined &&
          bundled.unresolvedPlugins === undefined &&
          bundled.disabledPlugins === undefined,
        bundled,
      )

      // Native mode: no injected plugins + no config anywhere above
      const native = await client.requestRaw('format', formatParams())
      check(
        'native mode: formats without a config file',
        native.formatted === '{ "a": 1 }\n',
        native,
      )
      check(
        'native mode: no error, no report fields',
        native.error === undefined && native.loadedPlugins === undefined,
        native,
      )
    } finally {
      await client.kill()
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}

async function customConfigSuite() {
  console.log(
    '\n== Custom config file: explicit resolveConfig + error report ==',
  )
  // Exercises the service-side resolution of the client's custom config
  // file (prettier.config.file) — JSON, YAML, JS and a missing file.
  // Runs in a tmpdir so the repo's own .prettierrc never interferes.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prettier-custom-'))
  try {
    fs.writeFileSync(path.join(tmpDir, 'file.json'), '{"a": {"b": 1}}\n')
    fs.writeFileSync(
      path.join(tmpDir, 'custom.json'),
      JSON.stringify({ useTabs: true, printWidth: 10 }),
    )
    fs.writeFileSync(
      path.join(tmpDir, 'custom.yaml'),
      'useTabs: true\nprintWidth: 10\n',
    )
    fs.writeFileSync(
      path.join(tmpDir, 'custom.js'),
      'module.exports = { useTabs: true, printWidth: 10 }\n',
    )

    const formatParams = (customConfigFile) => ({
      original: '{"a": {"b": 1}}\n',
      pathForConfig: path.join(tmpDir, 'file.json'),
      ignorePath: null,
      options: {
        parser: 'json',
        filepath: path.join(tmpDir, 'file.json'),
        cursorOffset: 0,
        _customConfigFile: customConfigFile,
      },
      withCursor: false,
    })

    const client = createServiceClient({ cwd: tmpDir })
    try {
      await client.waitForStart()

      // 1) JSON custom config — tabWidth-independent: useTabs visible in
      //    the nested indentation.
      const jsonConfig = await client.requestRaw(
        'format',
        formatParams(path.join(tmpDir, 'custom.json')),
      )
      check(
        'custom JSON config applied (tabs in output)',
        jsonConfig.formatted !== undefined &&
          jsonConfig.formatted.includes('\t'),
        jsonConfig,
      )
      check(
        'custom JSON config: no error, no configError',
        jsonConfig.error === undefined && jsonConfig.configError === undefined,
        jsonConfig,
      )

      // 2) YAML custom config — the old client-side JSON.parse dropped
      //    this format silently.
      const yamlConfig = await client.requestRaw(
        'format',
        formatParams(path.join(tmpDir, 'custom.yaml')),
      )
      check(
        'custom YAML config applied (tabs in output)',
        yamlConfig.formatted !== undefined &&
          yamlConfig.formatted.includes('\t'),
        yamlConfig,
      )
      check(
        'custom YAML config: no error, no configError',
        yamlConfig.error === undefined && yamlConfig.configError === undefined,
        yamlConfig,
      )

      // 3) JS custom config
      const jsConfig = await client.requestRaw(
        'format',
        formatParams(path.join(tmpDir, 'custom.js')),
      )
      check(
        'custom JS config applied (tabs in output)',
        jsConfig.formatted !== undefined && jsConfig.formatted.includes('\t'),
        jsConfig,
      )

      // 4) Missing custom config file → configError, formatting continues
      //    with the remaining options.
      const missing = await client.requestRaw(
        'format',
        formatParams(path.join(tmpDir, 'does-not-exist.json')),
      )
      check(
        'missing custom config file → configError reported',
        missing.configError?.path ===
          path.join(tmpDir, 'does-not-exist.json') &&
          typeof missing.configError.message === 'string',
        missing.configError,
      )
      check(
        'missing custom config file: formatting continues',
        missing.formatted === '{ "a": { "b": 1 } }\n',
        missing,
      )
    } finally {
      await client.kill()
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}

async function main() {
  requireBuiltArtifacts()
  await bundledSuite()
  await nativeSuite()
  await configlessSuite()
  await customConfigSuite()

  console.log(
    `\n${failed === 0 ? 'All checks passed.' : `${failed} check(s) failed.`}`,
  )
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
