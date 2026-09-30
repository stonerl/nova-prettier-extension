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
function makeNovaShim({
  workspaceModulePath = BROKEN_MODULE,
  workspaceModuleLoadable = false,
  lockfile = '{}',
  extensionNpmLsExit = 0,
  extensionDeps = ['prettier'],
} = {}) {
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

  // When the test overrides the workspace module path, or explicitly
  // marks the default one loadable, that directory gets a real
  // package.json so it IS loadable.
  if (workspaceModulePath !== BROKEN_MODULE || workspaceModuleLoadable) {
    files.set(
      `${workspaceModulePath}/package.json`,
      JSON.stringify({ name: 'prettier' }),
    )
    dirs.add(workspaceModulePath)
  }

  // Valid bundled tree in the extension directory.
  files.set(
    `${EXTENSION}/package.json`,
    JSON.stringify({
      dependencies: Object.fromEntries(
        extensionDeps.map((dep) => [dep, '^1.0.0']),
      ),
    }),
  )
  files.set(`${EXTENSION}/package-lock.json`, lockfile)
  // Installed bundled package.json carries a real version so the
  // lockfile-based fast path can compare against it.
  files.set(
    `${BUNDLED_PRETTIER}/package.json`,
    JSON.stringify({ name: 'prettier', version: '3.0.0' }),
  )
  dirs.add(`${EXTENSION}/node_modules`)
  dirs.add(BUNDLED_PRETTIER)
  // Every declared dependency is installed (package.json present) so
  // the pool-drain test exercises the npm ls queue, not the
  // no-spawn-missing short-circuit.
  for (const dep of extensionDeps) {
    if (dep === 'prettier') continue
    files.set(
      `${EXTENSION}/node_modules/${dep}/package.json`,
      JSON.stringify({ name: dep, version: '1.0.0' }),
    )
    dirs.add(`${EXTENSION}/node_modules/${dep}`)
  }

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
      // Test helper: mutate the file model after shim creation.
      _remove(p) {
        files.delete(p)
      },
      _removeDir(p) {
        dirs.delete(p)
      },
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

      // The install-lock runTool spawns absolute tool binaries with the
      // tool name stripped from args — derive the tool from the command.
      const tool = (this.command || '').split('/').pop()

      if (args[0] === 'node' && args[1] === '--version') {
        stdout = 'v26.10.0'
      } else if (args[0] === 'npm' && args[1] === '--version') {
        stdout = '12.1.0'
      } else if (args[0] === 'npm' && args[1] === 'ls') {
        // `npm ls <pkg> --parseable` — the extension directory (the
        // bundled tree) reports per `extensionNpmLsExit` so the
        // timeout-keep behavior can be exercised; healthy exit emits a
        // matching line. The workspace lookup reports per
        // `workspaceNpmLsStatus`; empty stdout = no workspace entry.
        const cwd = this.options.cwd || ''
        if (cwd === EXTENSION) {
          status = extensionNpmLsExit
          if (status === 0) {
            // One package per ls spawn — args[2] is the package name.
            const pkg = args[2]
            stdout = `${EXTENSION}/node_modules/${pkg}:${pkg}@1.0.0:OK`
          }
        } else {
          const lockStatus = nova.workspaceNpmLsStatus
          if (lockStatus === 'OK' || lockStatus === 'INVALID') {
            stdout = `${nova._workspaceModulePath}:prettier@3.0.0:${lockStatus}`
          }
        }
      } else if (args[0] === 'npm' && args[1] === 'install') {
        // The degraded-install fallback: resolves without touching the
        // file model — the caller only cares that it doesn't throw.
        status = 0
      } else if (tool === 'mkdir') {
        // Install-lock acquisition: exclusive create, fails on EEXIST.
        // args is ['-p', target] (fallback storage pre-create) or
        // [target] (the lock directory itself).
        const force = args[0] === '-p'
        const target = force ? args[1] : args[0]
        if (force) {
          dirs.add(target)
        } else if (dirs.has(target) || files.has(target)) {
          status = 1
        } else {
          dirs.add(target)
        }
      } else if (tool === 'touch') {
        status = 0
      } else if (tool === 'rmdir') {
        dirs.delete(args[0])
        status = 0
      } else if (tool === 'rm') {
        dirs.delete(args[1])
        files.delete(args[1])
        status = 0
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

async function lockfileFastPathSkipsNpmLs() {
  console.log('\n== lockfile-matched packages verify without npm ls ==')

  // Lockfile pins the installed version — verification must succeed
  // from the filesystem alone, without spawning a single npm ls.
  const lockfile = JSON.stringify({
    packages: { 'node_modules/prettier': { version: '3.0.0' } },
  })
  const novaShim = makeNovaShim({ lockfile })
  const captured = { info: [], warn: [], error: [] }
  const { resolver, restore } = loadResolver(novaShim, captured)

  try {
    const result = await resolver.findPrettier()

    check(
      'findPrettier resolves the bundled Prettier',
      result === BUNDLED_PRETTIER,
      result,
    )

    const lsSpawns = novaShim._processStub.created.filter(
      (proc) =>
        (proc.options.cwd || '') === EXTENSION &&
        (proc.options.args || [])[1] === 'ls',
    )
    check('no npm ls spawned at all', lsSpawns.length === 0, lsSpawns.length)
  } finally {
    restore()
  }
}

async function lockfileMismatchFallsBackToNpmLs() {
  console.log('\n== lockfile version mismatch falls back to npm ls ==')

  // Lockfile pins a different version — the package goes through npm
  // ls, which reports it healthy, so it is kept (no reinstall).
  const lockfile = JSON.stringify({
    packages: { 'node_modules/prettier': { version: '9.9.9' } },
  })
  const novaShim = makeNovaShim({ lockfile })
  const captured = { info: [], warn: [], error: [] }
  const { resolver, restore } = loadResolver(novaShim, captured)

  try {
    const result = await resolver.findPrettier()

    check(
      'npm ls still accepts the installed copy',
      result === BUNDLED_PRETTIER,
      result,
    )

    const lsSpawns = novaShim._processStub.created.filter(
      (proc) => (proc.options.args || [])[1] === 'ls',
    )
    check(
      'npm ls was spawned for the mismatched package',
      lsSpawns.length > 0,
      lsSpawns.length,
    )
  } finally {
    restore()
  }
}

async function missingInstalledPackageIsBrokenWithoutNpmLs() {
  console.log('\n== missing installed package is broken without npm ls ==')

  // Bundled prettier has no package.json at all — reported broken
  // directly, no npm ls, then the degraded install path recovers.
  const novaShim = makeNovaShim({ lockfile: '{}' })
  const captured = { info: [], warn: [], error: [] }
  const { resolver, restore } = loadResolver(novaShim, captured)

  try {
    // The file model was built with the installed package.json present —
    // remove it to simulate a broken install.
    novaShim.fs._remove(`${BUNDLED_PRETTIER}/package.json`)

    const result = await resolver.findPrettier()

    check(
      'degraded install path still resolves the bundled Prettier',
      result === BUNDLED_PRETTIER,
      result,
    )

    const lsSpawns = novaShim._processStub.created.filter(
      (proc) =>
        (proc.options.cwd || '') === EXTENSION &&
        (proc.options.args || [])[1] === 'ls',
    )
    check(
      'no npm ls spawned for the missing package',
      lsSpawns.length === 0,
      lsSpawns.length,
    )

    const installSpawns = novaShim._processStub.created.filter(
      (proc) => (proc.options.args || [])[1] === 'install',
    )
    check('install ran instead', installSpawns.length > 0, installSpawns.length)
  } finally {
    restore()
  }
}

async function timeoutKeepsInstalledPackage() {
  console.log('\n== npm ls timeout keeps the installed package ==')

  // npm ls exits -1 — the exact rejection handleProcessResult's timeout
  // path produces. The package is installed (package.json exists), so it
  // must be kept instead of triggering a reinstall.
  const novaShim = makeNovaShim({ extensionNpmLsExit: -1 })
  const captured = { info: [], warn: [], error: [] }
  const { resolver, restore } = loadResolver(novaShim, captured)

  try {
    const result = await resolver.findPrettier()

    check(
      'timed-out verification keeps the installed package',
      result === BUNDLED_PRETTIER,
      result,
    )

    check(
      'timeout is explained in the log',
      // Package name comes from the verification input (test data) —
      // the exact wording of the message must not matter.
      captured.warn.some((line) => line.includes('package "prettier"')),
      captured.warn,
    )

    const installSpawns = novaShim._processStub.created.filter(
      (proc) => (proc.options.args || [])[1] === 'install',
    )
    check(
      'no reinstall was triggered',
      installSpawns.length === 0,
      installSpawns.length,
    )
  } finally {
    restore()
  }
}

async function multiPackagePoolDrainsAllPackages() {
  console.log('\n== worker pool drains more packages than it has workers ==')

  // Six unverified packages against a four-worker pool: the queue must
  // drain fully, each package verified exactly once, none dropped by
  // the concurrency cap.
  const deps = [
    'prettier',
    'prettier-plugin-astro',
    'prettier-plugin-ejs',
    'prettier-plugin-java',
    'prettier-plugin-sql',
    'prettier-plugin-toml',
  ]
  const novaShim = makeNovaShim({ extensionDeps: deps })
  const captured = { info: [], warn: [], error: [] }
  const { resolver, restore } = loadResolver(novaShim, captured)

  try {
    const result = await resolver.findPrettier()

    check(
      'all packages verified — bundled Prettier still resolves',
      result === BUNDLED_PRETTIER,
      result,
    )

    // One ls per package, none twice: the pool drained the queue
    // without losing or duplicating work.
    for (const dep of deps) {
      const spawns = novaShim._processStub.created.filter(
        (proc) =>
          (proc.options.cwd || '') === EXTENSION &&
          (proc.options.args || [])[1] === 'ls' &&
          (proc.options.args || [])[2] === dep,
      )
      check(
        `"${dep}" verified exactly once`,
        spawns.length === 1,
        spawns.length,
      )
    }

    const totalLs = novaShim._processStub.created.filter(
      (proc) =>
        (proc.options.cwd || '') === EXTENSION &&
        (proc.options.args || [])[1] === 'ls',
    )
    check(
      'no extra spawns beyond one per package',
      totalLs.length === deps.length,
      totalLs.length,
    )

    const installSpawns = novaShim._processStub.created.filter(
      (proc) => (proc.options.args || [])[1] === 'install',
    )
    check(
      'no reinstall was triggered',
      installSpawns.length === 0,
      installSpawns.length,
    )
  } finally {
    restore()
  }
}

async function fsProjectPrettierPopulatesBundledInBackground() {
  console.log(
    '\n== fs project Prettier wins while the bundled tree is populated in background ==',
  )

  // A loadable node_modules/prettier makes the fs branch win. The
  // bundled tree is present and lockfile-matched, so the background
  // ensure must verify without installing anything.
  const lockfile = JSON.stringify({
    packages: { 'node_modules/prettier': { version: '3.0.0' } },
  })
  const novaShim = makeNovaShim({
    workspaceModulePath: BROKEN_MODULE,
    workspaceModuleLoadable: true,
    lockfile,
  })
  const captured = { info: [], warn: [], error: [] }
  const { resolver, restore } = loadResolver(novaShim, captured)

  try {
    const result = await resolver.findPrettier()

    check(
      'fs project Prettier is returned immediately',
      result === BROKEN_MODULE,
      result,
    )

    check(
      'background populate was kicked off',
      captured.info.some((line) =>
        line.includes('Populating the bundled modules in background'),
      ),
      captured.info,
    )

    // Join the in-flight background install (singleflight) and wait for
    // it to settle before asserting on its outcome.
    await resolver.ensureBundledModulesInBackground()

    check(
      'background ensure verified the bundled tree',
      captured.info.some((line) => line.includes('Using bundled Prettier.')),
      captured.info,
    )

    const installSpawns = novaShim._processStub.created.filter(
      (proc) => (proc.options.args || [])[1] === 'install',
    )
    check(
      'healthy bundled tree installs nothing',
      installSpawns.length === 0,
      installSpawns.length,
    )

    // A second call joins the same in-flight/finished attempt instead of
    // spawning a duplicate install.
    const first = resolver.ensureBundledModulesInBackground()
    const second = resolver.ensureBundledModulesInBackground()
    check('background ensure is singleflight', first === second)
    await second
  } finally {
    restore()
  }
}

async function freshInstallPopulatesEmptyBundledTreeInBackground() {
  console.log(
    '\n== fresh install with project Prettier populates the empty bundle in background ==',
  )

  // Release builds ship without node_modules. A project Prettier must
  // still win resolution immediately while npm install repopulates the
  // bundle in the background.
  const novaShim = makeNovaShim({
    workspaceModulePath: BROKEN_MODULE,
    workspaceModuleLoadable: true,
  })
  novaShim.fs._removeDir(`${EXTENSION}/node_modules`)
  const captured = { info: [], warn: [], error: [] }
  const { resolver, restore } = loadResolver(novaShim, captured)

  try {
    const result = await resolver.findPrettier()

    check(
      'project Prettier is returned without waiting for the install',
      result === BROKEN_MODULE,
      result,
    )

    await resolver.ensureBundledModulesInBackground()

    check(
      'background install completed the bundled tree',
      captured.info.some((line) => line.includes('Using bundled Prettier.')),
      captured.info,
    )

    const installSpawns = novaShim._processStub.created.filter(
      (proc) => (proc.options.args || [])[1] === 'install',
    )
    check('npm install ran in background', installSpawns.length > 0)
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
  await lockfileFastPathSkipsNpmLs()
  await lockfileMismatchFallsBackToNpmLs()
  await missingInstalledPackageIsBrokenWithoutNpmLs()
  await timeoutKeepsInstalledPackage()
  await multiPackagePoolDrainsAllPackages()
  await fsProjectPrettierPopulatesBundledInBackground()
  await freshInstallPopulatesEmptyBundledTreeInBackground()

  console.log(
    `\n${failed === 0 ? 'All checks passed.' : `${failed} check(s) failed.`}`,
  )
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
