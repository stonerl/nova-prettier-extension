/**
 * prettier-info.test.js — Unit tests for the Prettier Info command
 * (main.js: _buildPrettierInfoLines / showPrettierInfo)
 *
 * @license MIT
 * @author Toni Förster
 * @copyright © 2026 Toni Förster
 *
 * Plain Node script — no test framework. Exits non-zero on failure.
 *
 * Verifies that the info dialog reports
 *   • which Prettier is used: bundled (auto or forced), project, an
 *     explicit module path with its setting scope, or not-resolved-yet,
 *   • the module path and the Prettier version read from disk,
 *   • the service state and the last failure reason,
 *   • Node/npm versions, the bundled plugins (with versions) and the
 *     external/unresolved/disabled plugin picture from the last format.
 *
 * Stubs formatter.js and module-resolver.js via the require cache (like
 * restart-cycle.test.js) and stubs global.nova with a file model, a
 * version-probe Process stub and a showInformativeMessage spy.
 */

const path = require('path')
const fs = require('fs')
const Module = require('module')

const SRC_DIR = fs.realpathSync(
  process.env.PRETTIER_INFO_SRC || path.join(__dirname, '..', 'src', 'Scripts'),
)
const MAIN = path.join(SRC_DIR, 'main.js')

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

const EXTENSION = '/tmp/nova-ext/prettier-extension'
const BUNDLED_PRETTIER = `${EXTENSION}/node_modules/prettier`
const PROJECT_PRETTIER = '/Users/tester/project/node_modules/prettier'

function stubModule(file, exportsObj) {
  const resolved = path.join(SRC_DIR, file)
  const m = new Module(resolved, null)
  m.exports = exportsObj
  m.loaded = true
  require.cache[resolved] = m
}

class FakeFormatter {
  constructor(runningModulePath = null) {
    this._runningModulePath = runningModulePath
    this._lastFailure = null
    this._lastLoadedPlugins = []
    this._lastUnresolvedPlugins = []
    this._lastDisabledPlugins = []
    this._service = null
  }
  isRunning() {
    return !!this._service
  }
}

/**
 * Nova shim with file model, version-probe Process stub and a
 * showInformativeMessage spy. Config getters read from mutable maps so
 * tests can exercise global-vs-workspace settings.
 */
function makeNovaShim() {
  const files = new Map()
  const dirs = new Set()
  const shownMessages = []
  const config = { workspace: {}, global: {} }

  files.set(
    `${BUNDLED_PRETTIER}/package.json`,
    JSON.stringify({ name: 'prettier', version: '3.7.2' }),
  )
  files.set(
    `${PROJECT_PRETTIER}/package.json`,
    JSON.stringify({ name: 'prettier', version: '3.0.0' }),
  )
  files.set(
    `${EXTENSION}/package.json`,
    JSON.stringify({ dependencies: { prettier: '^3.0.0' } }),
  )
  dirs.add(`${EXTENSION}/node_modules`)

  const shim = {
    inDevMode: () => false,
    version: [14, 0, 0],
    versionString: '14.0',
    environment: { HOME: '/Users/tester', PATH: '/usr/bin:/bin' },
    config: {
      get: (name) => config.global[name] ?? null,
    },
    workspace: {
      config: { get: (name) => config.workspace[name] ?? null },
      path: '/Users/tester/project',
      showInformativeMessage: (message) => {
        shownMessages.push(message)
        return Promise.resolve()
      },
    },
    extension: { path: EXTENSION, version: '3.9.11' },
    notifications: { add: () => Promise.resolve(), cancel: () => {} },
    localize: (key, value) => value ?? key,
    path: {
      isAbsolute: (p) => p.startsWith('/'),
      join: (...parts) => parts.filter((p) => p != null).join('/'),
      dirname: (p) => p.split('/').slice(0, -1).join('/') || '/',
    },
    fs: {
      tempdir: () => '/tmp/nova-shared/prettier',
      stat(p) {
        if (files.has(p)) return { isFile: () => true }
        if (dirs.has(p)) return { isDirectory: () => true }
        return null
      },
      open(p, _mode = 'r') {
        const entry = files.get(p)
        if (!entry) throw new Error(`ENOENT: ${p}`)
        return { read: () => entry, close() {} }
      },
    },
  }

  // Process stub for the node/npm version probes only.
  class FakeProcess {
    constructor(command, options) {
      this.options = options || {}
      this._stdoutHandlers = []
      this._exitHandlers = []
    }
    onStdout(fn) {
      this._stdoutHandlers.push(fn)
    }
    onStderr() {}
    onDidExit(fn) {
      this._exitHandlers.push(fn)
    }
    onNotify() {}
    start() {
      const args = this.options.args || []
      let stdout = ''
      let status = 0
      if (args[0] === 'node' && args[1] === '--version') {
        stdout = 'v26.10.0'
      } else if (args[0] === 'npm' && args[1] === '--version') {
        stdout = '12.1.0'
      } else {
        status = 1
      }
      if (stdout) this._stdoutHandlers.forEach((fn) => fn(stdout))
      this._exitHandlers.forEach((fn) => fn(status))
    }
    terminate() {}
  }

  global.Process = FakeProcess
  global.IssueCollection = class IssueCollection {}
  global.NotificationRequest = class NotificationRequest {
    constructor(id) {
      this.id = id
    }
  }

  global.nova = shim

  for (const file of [
    'helpers.js',
    'notifications.js',
    'prettier-plugins.js',
    'formatter.js',
    'module-resolver.js',
    'main.js',
  ]) {
    delete require.cache[path.join(SRC_DIR, file)]
  }

  // Seed a package.json (version 1.0.0) at the true package root of
  // every bundled plugin the registry reports. Roots are found the same
  // way main.js finds them: walk up until the parent is node_modules or
  // an @scope directory.
  const pluginPaths = require(path.join(SRC_DIR, 'prettier-plugins.js'))
  for (const [, pluginPath] of Object.entries(pluginPaths)) {
    let dir = path.dirname(pluginPath)
    for (let hops = 0; hops < 8; hops++) {
      const base = path.dirname(dir).split('/').pop()
      if (base === 'node_modules' || base.startsWith('@')) break
      dir = path.dirname(dir)
    }
    files.set(
      path.join(dir, 'package.json'),
      JSON.stringify({ version: '1.0.0' }),
    )
    dirs.add(dir)
  }
  return { shim, files, config, shownMessages }
}

// Fixture for the formatter.js stub: plugins whose registry entry file
// main.js should treat as missing in the current scenario.
let missingBundledPlugins = []

function makeInstance({ runningModulePath = null } = {}) {
  const { shim, files, config, shownMessages } = makeNovaShim()
  missingBundledPlugins = []

  stubModule('formatter.js', {
    Formatter: FakeFormatter,
    findMissingBundledPlugins: () => missingBundledPlugins,
  })
  stubModule('module-resolver.js', {
    findPrettier: async () => BUNDLED_PRETTIER,
  })

  const { PrettierExtension } = require(MAIN)
  const ext = new PrettierExtension()
  ext.formatter = new FakeFormatter(runningModulePath)

  return { ext, files, config, shownMessages, shim }
}

async function bundledInfo() {
  console.log('\n== bundled source, version, service state ==')

  const { ext, shownMessages } = makeInstance({
    runningModulePath: BUNDLED_PRETTIER,
  })
  ext.formatter._service = {}

  const lines = await ext._buildPrettierInfoLines()

  check('Source: Bundled', lines[0] === 'Source: Bundled', lines[0])
  check(
    'Module: resolved bundled path',
    lines.some((l) => l === `Module: ${BUNDLED_PRETTIER}`),
    lines,
  )
  check(
    'Version read from the module package.json',
    lines.some((l) => l === 'Version: 3.7.2'),
    lines,
  )
  check(
    'Service: running',
    lines.some((l) => l === 'Service: running'),
    lines,
  )
  check(
    'Node/npm line carries the probed versions',
    lines.some((l) => l === 'Node: v26.10.0 — npm: 12.1.0'),
    lines,
  )
  check(
    'no Last failure line without a failure',
    !lines.some((l) => l.startsWith('Last failure:')),
    lines,
  )

  await ext.showPrettierInfo()
  check(
    'showPrettierInfo shows the joined message',
    shownMessages.length === 1 &&
      shownMessages[0].includes('Source: Bundled') &&
      shownMessages[0].includes('\n'),
    shownMessages[0]?.slice(0, 120),
  )

  // Every registry plugin — regardless of its entry file's depth or
  // scope — must show with a version (the depth-bug regression check:
  // ejs/properties sit one level up, nginx three, scoped ones under
  // @org/).
  const withPlugins = await ext._buildPrettierInfoLines()
  const pluginLine = withPlugins
    .find((l) => l.startsWith('Bundled plugins:'))
    ?.slice('Bundled plugins: '.length)
  const pluginNames = Object.keys(
    require(path.join(SRC_DIR, 'prettier-plugins.js')),
  )
  const missing = pluginNames.filter(
    (name) => !pluginLine?.includes(`${name} (1.0.0)`),
  )
  check(
    'every bundled plugin shows with a version (all depth variants)',
    missing.length === 0,
    missing,
  )

  // A plugin whose registry entry file is missing (registry drift after
  // a plugin update) must show as "(missing)" instead of a version,
  // without disturbing the other plugins' lines.
  const pluginPaths = require(path.join(SRC_DIR, 'prettier-plugins.js'))
  missingBundledPlugins = [{ key: 'ejs', path: pluginPaths.ejs }]

  const withMissing = await ext._buildPrettierInfoLines()
  const missingLine = withMissing
    .find((l) => l.startsWith('Bundled plugins:'))
    ?.slice('Bundled plugins: '.length)

  check(
    'missing plugin shows as "(missing)"',
    missingLine?.includes('ejs (missing)') === true,
    missingLine,
  )
  check(
    'missing plugin shows no version',
    missingLine?.includes('ejs (1.0.0)') === false,
    missingLine,
  )
  check(
    'present plugins still show versions next to the missing one',
    missingLine?.includes('astro (1.0.0)') === true,
    missingLine,
  )
}

async function projectAndExplicitPaths() {
  console.log('\n== project / explicit-path source labels ==')

  {
    const { ext } = makeInstance({ runningModulePath: PROJECT_PRETTIER })
    ext.formatter._service = {}
    const lines = await ext._buildPrettierInfoLines()
    check(
      'outside the bundle → Source: Project',
      lines[0] === 'Source: Project',
      lines[0],
    )
    check(
      'Version read from the project module',
      lines.some((l) => l === 'Version: 3.0.0'),
      lines,
    )
  }

  {
    const { ext, config } = makeInstance()
    config.global['prettier.module.path'] = PROJECT_PRETTIER
    const lines = await ext._buildPrettierInfoLines()
    check(
      'explicit global path → labeled as global setting',
      lines[0] === 'Source: Explicit module path (global setting)',
      lines[0],
    )
  }

  {
    const { ext, config } = makeInstance()
    config.workspace['prettier.module.path'] = PROJECT_PRETTIER
    config.global['prettier.module.path'] = PROJECT_PRETTIER
    const lines = await ext._buildPrettierInfoLines()
    check(
      'workspace override → labeled as workspace setting',
      lines[0] === 'Source: Explicit module path (workspace setting)',
      lines[0],
    )
  }

  {
    const { ext } = makeInstance()
    const lines = await ext._buildPrettierInfoLines()
    check(
      'nothing resolved → Not resolved yet',
      lines[0] === 'Source: Not resolved yet',
      lines[0],
    )
    check(
      'Module line says not resolved',
      lines.some((l) => l === 'Module: not resolved yet'),
      lines,
    )
  }
}

async function preferBundledLabel() {
  console.log('\n== preferBundled label ==')
  const { ext, config } = makeInstance()
  config.global['prettier.module.preferBundled'] = true
  const lines = await ext._buildPrettierInfoLines()
  check(
    'preferBundled → labeled as forced',
    lines[0] === 'Source: Bundled (preferBundled forced)',
    lines[0],
  )
}

async function lastFailureAndPlugins() {
  console.log('\n== last failure + plugin picture ==')

  const { ext } = makeInstance({ runningModulePath: BUNDLED_PRETTIER })
  ext.formatter._lastFailure = new Error('Process timed out after 30000ms')
  ext.formatter._lastLoadedPlugins = ['prettier-plugin-tailwindcss']
  ext.formatter._lastUnresolvedPlugins = ['prettier-plugin-fancy']
  ext.formatter._lastDisabledPlugins = ['prettier-plugin-broken']

  const lines = await ext._buildPrettierInfoLines()
  check(
    'Last failure line carries the described reason',
    lines.some((l) =>
      l.includes(
        'Last failure: A Node.js process didn’t respond within 30 seconds',
      ),
    ),
    lines,
  )
  check(
    'external plugins shown from the last format',
    lines.some(
      (l) =>
        l === 'External plugins (last format): prettier-plugin-tailwindcss',
    ),
    lines,
  )
  check(
    'unresolved plugins shown',
    lines.some((l) => l === 'Unresolved plugins: prettier-plugin-fancy'),
    lines,
  )
  check(
    'disabled plugins shown',
    lines.some((l) => l === 'Disabled plugins: prettier-plugin-broken'),
    lines,
  )
}

async function main() {
  await bundledInfo()
  await projectAndExplicitPaths()
  await preferBundledLabel()
  await lastFailureAndPlugins()

  console.log(
    `\n${failed === 0 ? 'All checks passed.' : `${failed} check(s) failed.`}`,
  )
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
