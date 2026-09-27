/**
 * resolver-guard.test.js — Unit tests for the broken-project-Prettier
 * guard in module-resolver.js
 *
 * @license MIT
 * @author Toni Förster
 * @copyright © 2026 Toni Förster
 *
 * Plain Node script — no test framework. Exits non-zero on failure.
 *
 * Covers the follow-up review gaps for the isLoadableModule guard:
 *   • the predicate itself (package.json present / missing / a directory)
 *   • the flow: a workspace with a broken node_modules/prettier (dir
 *     without package.json — e.g. a pnpm symlink into an empty store
 *     entry) must NOT be returned; findPrettier falls through to the
 *     bundled Prettier instead,
 *   • the fallback warn fires once per broken path — repeat resolutions
 *     (watcher-triggered restart cycles) demote it to debug instead of
 *     re-printing the full warning every cycle.
 *
 * Stubs global.nova with an in-memory file model and global.Process with
 * a behavior-dispatching FakeProcess (node/npm version probes and
 * `npm ls` verification spawns) so no real binaries run.
 */

const path = require('path')
const fs = require('fs')

const SRC_DIR = fs.realpathSync(
  process.env.RESOLVER_GUARD_SRC ||
    path.join(__dirname, '..', 'src', 'Scripts'),
)

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

const WORKSPACE = '/Users/tester/project'
const EXTENSION = '/tmp/nova-ext/prettier-extension'
const BROKEN_MODULE = `${WORKSPACE}/node_modules/prettier`
const BUNDLED_PRETTIER = `${EXTENSION}/node_modules/prettier`

/**
 * Nova shim with an in-memory file model (files map path → content,
 * dirs a set) plus Process emulation for the version probes and npm ls
 * spawns module-resolver.js performs.
 */
function makeNovaShim({ workspaceModulePath = BROKEN_MODULE } = {}) {
  const files = new Map()
  const dirs = new Set()

  // Valid workspace package.json declaring prettier…
  files.set(
    `${WORKSPACE}/package.json`,
    JSON.stringify({ devDependencies: { prettier: '^3.0.0' } }),
  )
  // …with a broken install: node_modules/prettier exists but has no
  // package.json (pnpm symlink into an empty store entry).
  dirs.add(`${WORKSPACE}/node_modules`)
  dirs.add(BROKEN_MODULE)

  // When the test overrides the workspace module path, that directory
  // gets a real package.json so it IS loadable.
  if (workspaceModulePath !== BROKEN_MODULE) {
    files.set(
      `${workspaceModulePath}/package.json`,
      JSON.stringify({ name: 'prettier' }),
    )
    dirs.add(workspaceModulePath)
  }

  // Valid bundled tree in the extension directory.
  files.set(
    `${EXTENSION}/package.json`,
    JSON.stringify({ dependencies: { prettier: '^3.0.0' } }),
  )
  files.set(`${EXTENSION}/package-lock.json`, '{}')
  files.set(
    `${BUNDLED_PRETTIER}/package.json`,
    JSON.stringify({ name: 'prettier' }),
  )
  dirs.add(`${EXTENSION}/node_modules`)
  dirs.add(BUNDLED_PRETTIER)

  const shim = {
    inDevMode: () => false,
    version: [14, 0, 0],
    versionString: '14.0',
    environment: {
      HOME: '/Users/tester',
      PATH: '/usr/local/bin:/usr/bin:/bin',
    },
    config: { get: () => null },
    workspace: { config: { get: () => null }, path: WORKSPACE },
    extension: { path: EXTENSION, globalStoragePath: '/tmp/nova-global' },
    notifications: { post: () => {}, cancel: () => {} },
    localize: (key, value) => value ?? key,
    // What `npm ls prettier` reports for the workspace entry. 'NONE'
    // means no entry at all (no stdout); 'OK'/'INVALID' produce a real
    // ls line so the correctVersion guard can be exercised without
    // extra file-model surgery.
    workspaceNpmLsStatus: 'NONE',
    // The module path the workspace npm ls entry reports. Defaults to
    // the broken dir; the healthy-path test points it at a valid one.
    _workspaceModulePath: workspaceModulePath,
    path: {
      isAbsolute: (p) => p.startsWith('/'),
      join: (...parts) => parts.filter((p) => p != null).join('/'),
      dirname: (p) => p.split('/').slice(0, -1).join('/') || '/',
    },
    fs: {
      tempdir: () => '/tmp/nova-shared/prettier',
      stat(p) {
        if (files.has(p)) {
          return { isFile: () => true, isDirectory: () => false }
        }
        if (dirs.has(p)) {
          return { isFile: () => false, isDirectory: () => true }
        }
        return null
      },
      open(p, _mode = 'r') {
        const entry = files.get(p)
        if (!entry) throw new Error(`ENOENT: ${p}`)
        return { read: () => entry, close() {} }
      },
      remove() {},
    },
  }

  // Process stub: dispatches on the spawn arguments.
  const created = []
  class FakeProcess {
    constructor(command, options) {
      this.command = command
      this.options = options || {}
      this._stdoutHandlers = []
      this._stderrHandlers = []
      this._exitHandlers = []
      created.push(this)
    }
    onStdout(fn) {
      this._stdoutHandlers.push(fn)
    }
    onStderr(fn) {
      this._stderrHandlers.push(fn)
    }
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
      } else if (args[0] === 'npm' && args[1] === 'ls') {
        // `npm ls <pkg> --parseable` — the extension directory (the
        // bundled tree) always verifies as healthy. The workspace lookup
        // reports per `workspaceNpmLsStatus` so the correctVersion guard
        // can be exercised; empty stdout = no workspace entry.
        const cwd = this.options.cwd || ''
        if (cwd === EXTENSION) {
          stdout = `${BUNDLED_PRETTIER}:prettier@3.0.0:OK`
        } else {
          const status = nova.workspaceNpmLsStatus
          if (status === 'OK' || status === 'INVALID') {
            stdout = `${nova._workspaceModulePath}:prettier@3.0.0:${status}`
          }
        }
      } else {
        status = 1
      }

      if (stdout) this._stdoutHandlers.forEach((fn) => fn(stdout))
      this._exitHandlers.forEach((fn) => fn(status))
    }
    terminate() {}
  }

  shim._processStub = { FakeProcess, created }
  return shim
}

/**
 * Captures helper-log output by swapping the console methods the log
 * helpers call, then requires a fresh module-resolver.js.
 */
function loadResolver(novaShim, captured) {
  global.nova = novaShim
  global.Process = novaShim._processStub.FakeProcess
  global.IssueCollection = class IssueCollection {}

  const original = {
    info: console.info,
    warn: console.warn,
    error: console.error,
  }
  console.info = (...args) => captured.info.push(args.join(' '))
  console.warn = (...args) => captured.warn.push(args.join(' '))
  console.error = (...args) => captured.error.push(args.join(' '))

  for (const file of ['helpers.js', 'notifications.js', 'module-resolver.js']) {
    delete require.cache[path.join(SRC_DIR, file)]
  }

  const resolver = require(path.join(SRC_DIR, 'module-resolver.js'))

  const restore = () => {
    console.info = original.info
    console.warn = original.warn
    console.error = original.error
  }

  return { resolver, restore }
}

function predicateChecks() {
  console.log('\n== isLoadableModule predicate ==')

  const novaShim = makeNovaShim()
  const captured = { info: [], warn: [], error: [] }
  const { resolver, restore } = loadResolver(novaShim, captured)

  try {
    check(
      'valid module directory → true',
      resolver.isLoadableModule(BUNDLED_PRETTIER) === true,
    )

    check(
      'broken module directory (no package.json) → false',
      resolver.isLoadableModule(BROKEN_MODULE) === false,
    )

    // Weird tree: "package.json" exists but is a directory.
    novaShim.fs.open = undefined
    check(
      'unknown path → false',
      resolver.isLoadableModule(`${WORKSPACE}/nonexistent`) === false,
    )
  } finally {
    restore()
  }
}

async function brokenWorkspaceFallsBackToBundled() {
  console.log('\n== broken workspace install falls through to bundled ==')

  const novaShim = makeNovaShim()
  const captured = { info: [], warn: [], error: [] }
  const { resolver, restore } = loadResolver(novaShim, captured)

  try {
    const result = await resolver.findPrettier()

    check(
      'findPrettier returns the bundled Prettier, not the broken one',
      result === BUNDLED_PRETTIER,
      result,
    )

    check(
      'fallback warn logged for the broken path',
      captured.warn.some((line) =>
        line.includes(`Ignoring project prettier at ${BROKEN_MODULE}`),
      ),
      captured.warn,
    )
  } finally {
    restore()
  }

  return { novaShim, captured }
}

async function warnFiresOncePerBrokenPath() {
  console.log('\n== fallback warn is deduped per path ==')

  const novaShim = makeNovaShim()
  const captured = { info: [], warn: [], error: [] }
  const { resolver, restore } = loadResolver(novaShim, captured)

  try {
    await resolver.findPrettier()
    // Second resolution (watcher-triggered restart cycle) against the
    // still-broken install — the warn must not repeat.
    await resolver.findPrettier()

    const warnCount = captured.warn.filter((line) =>
      line.includes('Ignoring project prettier'),
    ).length

    check(
      'warn printed once despite repeated resolutions',
      warnCount === 1,
      warnCount,
    )
  } finally {
    restore()
  }
}

async function invalidWorkspaceInstallFallsBackToBundled() {
  console.log(
    '\n== npm ls INVALID workspace install falls through to bundled ==',
  )

  // A loadable-but-INVALID workspace module: the file model is fine,
  // only npm ls's status flags it — the correctVersion guard's case.
  const invalidModule = `${WORKSPACE}/node_modules/prettier-invalid`
  const novaShim = makeNovaShim({ workspaceModulePath: invalidModule })
  const captured = { info: [], warn: [], error: [] }
  const { resolver, restore } = loadResolver(novaShim, captured)

  try {
    novaShim.workspaceNpmLsStatus = 'INVALID'
    const result = await resolver.findPrettier()

    check(
      'INVALID install is skipped — bundled Prettier takes over',
      result === BUNDLED_PRETTIER,
      result,
    )

    check(
      'fallback warn names the npm ls reason',
      captured.warn.some((line) =>
        line.includes(
          `Ignoring project prettier at ${invalidModule} — npm ls reports it as invalid or outdated`,
        ),
      ),
      captured.warn,
    )

    // Repeat resolution against the still-flagged install — the
    // npm-ls reason must not warn again.
    await resolver.findPrettier()
    const invalidWarnCount = captured.warn.filter((line) =>
      line.includes('npm ls reports it as invalid or outdated'),
    ).length

    check(
      'npm-ls reason warned once despite repeated resolutions',
      invalidWarnCount === 1,
      invalidWarnCount,
    )
  } finally {
    restore()
  }
}

async function healthyWorkspaceInstallStillLoads() {
  console.log('\n== healthy workspace npm ls entry is still used ==')

  // A loadable workspace prettier with a matching version must NOT be
  // skipped by the correctVersion guard.
  const validModule = `${WORKSPACE}/node_modules/prettier-valid`
  const novaShim = makeNovaShim({ workspaceModulePath: validModule })
  const captured = { info: [], warn: [], error: [] }
  const { resolver, restore } = loadResolver(novaShim, captured)

  try {
    novaShim.workspaceNpmLsStatus = 'OK'
    const result = await resolver.findPrettier()

    check(
      'loadable workspace install is loaded (npm path)',
      result === validModule,
      result,
    )
    check(
      'no correctVersion warn logged',
      !captured.warn.some((line) => line.includes('invalid or outdated')),
      captured.warn,
    )
  } finally {
    restore()
  }
}

async function main() {
  predicateChecks()
  await brokenWorkspaceFallsBackToBundled()
  await warnFiresOncePerBrokenPath()
  await invalidWorkspaceInstallFallsBackToBundled()
  await healthyWorkspaceInstallStillLoads()

  console.log(
    `\n${failed === 0 ? 'All checks passed.' : `${failed} check(s) failed.`}`,
  )
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
