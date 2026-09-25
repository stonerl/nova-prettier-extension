/**
 * runtime-resolver.test.js — Unit tests for the Node.js/npm runtime
 * resolution in helpers.js
 *
 * @license MIT
 * @author Toni Förster
 * @copyright © 2026 Toni Förster
 *
 * Plain Node script — no test framework. Exits non-zero on failure.
 *
 * Verifies that the runtime resolver
 *   • keeps the PATH lookup (`/usr/bin/env node`) as the fast path,
 *   • falls back to Nova's managed-tools install (Tools/bin symlinks,
 *     the per-package nova-receipt.json, then a directory scan) when
 *     PATH has no node, and
 *   • runs npm through the managed node binary (npm's entry script
 *     relies on a `#!/usr/bin/env node` shebang that fails when node
 *     is not on PATH).
 *
 * Stubs global.nova and the Process class, and busts the require cache
 * between scenarios so each gets a fresh resolver with empty caches.
 */

const path = require('path')
const fs = require('fs')

const SRC_DIR = fs.realpathSync(
  process.env.RUNTIME_RESOLVER_SRC ||
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

/**
 * Configurable Process stub. `behavior` maps the options passed to the
 * constructor onto a run result:
 *   { status, stdout, startThrows }
 */
function makeProcessStub(behavior) {
  const created = []

  class FakeProcess {
    constructor(command, options) {
      this.command = command
      this.options = options
      this._stdoutHandlers = []
      this._exitHandlers = []
      created.push(this)
    }

    onStdout(fn) {
      this._stdoutHandlers.push(fn)
    }

    onDidExit(fn) {
      this._exitHandlers.push(fn)
    }

    onNotify() {}

    start() {
      const result = behavior(this.command, this.options) || {}
      if (result.startThrows) throw new Error('spawn failed')
      if (result.stdout) {
        this._stdoutHandlers.forEach((fn) => fn(result.stdout))
      }
      this._exitHandlers.forEach((fn) => fn(result.status ?? 0))
    }
  }

  return { FakeProcess, created }
}

const HOME = '/Users/tester'
const TOOLS = `${HOME}/Library/Application Support/Nova/Tools`

/**
 * Nova shim backed by a simple file/directory model. `files` maps
 * absolute paths to file contents (undefined content = binary present),
 * `dirs` lists existing directories.
 */
function makeNovaShim({ home, extensionPath, files = {}, dirs = [] }) {
  return {
    inDevMode: () => false,
    version: [14, 0, 0],
    versionString: '14.0',
    environment:
      home === undefined
        ? {}
        : { HOME: home, PATH: '/usr/local/bin:/usr/bin:/bin' },
    config: { get: () => null },
    workspace: { config: { get: () => null }, path: null },
    notifications: { cancel: () => {}, post: () => {} },
    extension: { path: extensionPath },
    path: {
      join: (...parts) => parts.filter((p) => p != null).join('/'),
    },
    fs: {
      stat(p) {
        if (Object.prototype.hasOwnProperty.call(files, p)) {
          return { isFile: () => true, isDirectory: () => false }
        }
        if (dirs.includes(p)) {
          return { isFile: () => false, isDirectory: () => true }
        }
        return null
      },
      listdir(p) {
        if (!dirs.includes(p)) throw new Error(`ENOENT: ${p}`)
        const names = new Set()
        for (const dir of dirs) {
          if (dir.startsWith(`${p}/`)) {
            names.add(dir.slice(p.length + 1).split('/')[0])
          }
        }
        for (const file of Object.keys(files)) {
          if (file.startsWith(`${p}/`)) {
            names.add(file.slice(p.length + 1).split('/')[0])
          }
        }
        return [...names]
      },
      open(p) {
        if (!Object.prototype.hasOwnProperty.call(files, p)) {
          throw new Error(`ENOENT: ${p}`)
        }
        const contents = files[p]
        return {
          read: () => contents ?? '',
          close() {},
        }
      },
    },
  }
}

/**
 * Requires a fresh helpers.js with the given shims. The module holds
 * cache state (_nodeRuntimePromise, _cliVersionPromises), so both
 * helpers.js and notifications.js must be evicted between scenarios.
 */
function loadHelpers(novaShim, ProcessShim) {
  global.nova = novaShim
  global.Process = ProcessShim

  for (const file of ['helpers.js', 'notifications.js']) {
    const resolved = path.join(SRC_DIR, file)
    delete require.cache[resolved]
  }
  return require(path.join(SRC_DIR, 'helpers.js'))
}

async function envPathWins() {
  console.log('\n== PATH lookup stays the fast path ==')

  const { FakeProcess, created } = makeProcessStub((command, options) => ({
    stdout: options.args[0] === 'npm' ? '10.2.3\n' : 'v22.0.0\n',
    status: 0,
  }))
  const helpers = loadHelpers(
    makeNovaShim({ home: HOME, extensionPath: '/dev/prettier.novaextension' }),
    FakeProcess,
  )

  const runtime = await helpers.resolveNodeRuntime()
  check(
    'env runtime detected',
    runtime &&
      runtime.mode === 'env' &&
      runtime.nodePath === 'node' &&
      runtime.npmPath === 'npm' &&
      runtime.nodeVersion === 'v22.0.0',
    runtime,
  )

  const nodeProc = await helpers.spawnNode(['-e', '1'], { cwd: '/tmp' })
  check(
    'spawnNode keeps /usr/bin/env invocation',
    nodeProc.command === '/usr/bin/env' &&
      nodeProc.options.args.join(' ') === 'node -e 1' &&
      nodeProc.options.cwd === '/tmp',
    nodeProc,
  )
  check(
    'env mode injects no environment overrides',
    nodeProc.options.env === undefined,
    nodeProc.options.env,
  )

  const npmProc = await helpers.spawnNpm(['install', '--omit=dev'])
  check(
    'spawnNpm keeps /usr/bin/env invocation',
    npmProc.command === '/usr/bin/env' &&
      npmProc.options.args.join(' ') === 'npm install --omit=dev',
    npmProc,
  )

  check(
    'node version read from resolver probe',
    (await helpers.getCliVersion('node')) === 'v22.0.0',
  )
  check(
    'npm version spawns npm --version',
    (await helpers.getCliVersion('npm')) === '10.2.3',
  )
  check('no managed lookup ran', created.length === 4, created.length)
}

async function managedViaToolsBin() {
  console.log('\n== Tools/bin symlinks are the first managed fallback ==')

  const nodeBin = `${TOOLS}/bin/node`
  const npmBin = `${TOOLS}/bin/npm`

  const { FakeProcess } = makeProcessStub((command, options) => ({
    stdout: command === '/usr/bin/env' ? '' : 'v25.9.0\n',
    status: command === '/usr/bin/env' ? 127 : 0,
    ...(command === '/usr/bin/env' ? { stdout: '' } : {}),
    ...(options.args[0] === 'npm' || options.args[0]?.includes?.('npm')
      ? { stdout: '10.2.3\n' }
      : {}),
  }))
  const helpers = loadHelpers(
    makeNovaShim({
      home: HOME,
      extensionPath: '/dev/prettier.novaextension',
      files: { [nodeBin]: undefined, [npmBin]: undefined },
    }),
    FakeProcess,
  )

  const runtime = await helpers.resolveNodeRuntime()
  check(
    'managed runtime detected via Tools/bin',
    runtime &&
      runtime.mode === 'managed' &&
      runtime.nodePath === nodeBin &&
      runtime.npmPath === npmBin,
    runtime,
  )

  const npmProc = await helpers.spawnNpm(['install', '--omit=dev'])
  check(
    'managed npm runs through managed node',
    npmProc.command === nodeBin &&
      npmProc.options.args[0] === npmBin &&
      npmProc.options.args[1] === 'install',
    npmProc,
  )
  check(
    'managed npm PATH prepends the binary directory',
    npmProc.options.env.PATH === `${TOOLS}/bin:/usr/local/bin:/usr/bin:/bin`,
    npmProc.options.env,
  )
  check(
    'caller-provided env overrides survive the merge',
    (await helpers
      .spawnNpm(['install'], { env: { DEBUG: '1' } })
      .then(
        (p) =>
          p.options.env.DEBUG === '1' &&
          p.options.env.PATH.startsWith(`${TOOLS}/bin:`),
      )) === true,
  )

  const nodeProc = await helpers.spawnNode(['--version'])
  check(
    'managed node spawns directly',
    nodeProc.command === nodeBin &&
      nodeProc.options.args.join(' ') === '--version',
    nodeProc,
  )
  check(
    'managed node PATH prepends the binary directory',
    nodeProc.options.env.PATH === `${TOOLS}/bin:/usr/local/bin:/usr/bin:/bin`,
    nodeProc.options.env,
  )

  check(
    'npm version resolved through managed npm',
    (await helpers.getCliVersion('npm')) === '10.2.3',
  )
}

async function managedViaReceipt() {
  console.log('\n== nova-receipt.json is the second managed fallback ==')

  const versionDir = `${TOOLS}/packages/node/node-25.9.0-darwin-arm64`
  const nodeBin = `${versionDir}/bin/node`
  const npmBin = `${versionDir}/bin/npm`

  const { FakeProcess } = makeProcessStub((command) => ({
    stdout: command === '/usr/bin/env' ? '' : 'v25.9.0\n',
    status: command === '/usr/bin/env' ? 127 : 0,
  }))
  const helpers = loadHelpers(
    makeNovaShim({
      home: HOME,
      extensionPath: '/dev/prettier.novaextension',
      files: {
        [`${TOOLS}/packages/node/nova-receipt.json`]: JSON.stringify({
          source: 'pkg:generic/nodejs/node@v25.9.0',
          id: 'node',
          bin: {
            node: 'node-25.9.0-darwin-arm64/bin/node',
            npm: 'node-25.9.0-darwin-arm64/bin/npm',
            npx: 'node-25.9.0-darwin-arm64/bin/npx',
          },
        }),
        [nodeBin]: undefined,
        [npmBin]: undefined,
      },
      dirs: [`${TOOLS}/packages/node`, versionDir],
    }),
    FakeProcess,
  )

  const runtime = await helpers.resolveNodeRuntime()
  check(
    'receipt paths used for both binaries',
    runtime &&
      runtime.mode === 'managed' &&
      runtime.nodePath === nodeBin &&
      runtime.npmPath === npmBin,
    runtime,
  )

  const nodeProc = await helpers.spawnNode(['--version'])
  check(
    'receipt PATH prepends the versioned bin directory',
    nodeProc.options.env.PATH ===
      `${versionDir}/bin:/usr/local/bin:/usr/bin:/bin`,
    nodeProc.options.env,
  )
}

async function managedViaDirectoryScan() {
  console.log('\n== Directory scan is the last managed fallback ==')

  const versionDir = `${TOOLS}/packages/node/node-25.9.0-darwin-x64`
  const nodeBin = `${versionDir}/bin/node`
  const npmBin = `${versionDir}/bin/npm`

  const { FakeProcess } = makeProcessStub((command) => ({
    stdout: command === '/usr/bin/env' ? '' : 'v25.9.0\n',
    status: command === '/usr/bin/env' ? 127 : 0,
  }))
  const helpers = loadHelpers(
    makeNovaShim({
      home: HOME,
      extensionPath: '/dev/prettier.novaextension',
      files: { [nodeBin]: undefined, [npmBin]: undefined },
      dirs: [`${TOOLS}/packages/node`, versionDir],
    }),
    FakeProcess,
  )

  const runtime = await helpers.resolveNodeRuntime()
  check(
    'scan finds node-<version>-<arch>/bin layout',
    runtime &&
      runtime.mode === 'managed' &&
      runtime.nodePath === nodeBin &&
      runtime.npmPath === npmBin,
    runtime,
  )

  const npmProc = await helpers.spawnNpm(['install'])
  check(
    'scan PATH prepends the versioned bin directory',
    npmProc.options.env.PATH ===
      `${versionDir}/bin:/usr/local/bin:/usr/bin:/bin`,
    npmProc.options.env,
  )
}

async function brokenManagedNodeIsRejectedAndReprobed() {
  console.log('\n== A managed node that fails to run is rejected ==')

  let runs = 0
  const { FakeProcess } = makeProcessStub((command) => {
    if (command === '/usr/bin/env') return { status: 127 }
    runs++
    return { status: 1 }
  })
  const helpers = loadHelpers(
    makeNovaShim({
      home: HOME,
      extensionPath: '/dev/prettier.novaextension',
      files: {
        [`${TOOLS}/bin/node`]: undefined,
        [`${TOOLS}/bin/npm`]: undefined,
      },
    }),
    FakeProcess,
  )

  check(
    'broken managed node resolves to null',
    (await helpers.resolveNodeRuntime()) === null,
  )

  await helpers.resolveNodeRuntime()
  check('failed probe is not cached — resolver re-probed', runs === 2, runs)

  let rejected = null
  try {
    await helpers.spawnNode(['--version'])
  } catch (err) {
    rejected = err.message
  }
  check(
    'spawnNode rejects without a usable runtime',
    typeof rejected === 'string' && rejected.length > 0,
    rejected,
  )
}

async function homeIsDerivedWithoutEnvironment() {
  console.log('\n== Home falls back to the released extension path ==')

  const nodeBin = `${TOOLS}/bin/node`
  const npmBin = `${TOOLS}/bin/npm`

  const { FakeProcess } = makeProcessStub((command) => ({
    stdout: command === '/usr/bin/env' ? '' : 'v25.9.0\n',
    status: command === '/usr/bin/env' ? 127 : 0,
  }))
  const helpers = loadHelpers(
    makeNovaShim({
      home: undefined,
      extensionPath: `${HOME}/Library/Application Support/Nova/Extensions/stonerl.prettier`,
      files: { [nodeBin]: undefined, [npmBin]: undefined },
    }),
    FakeProcess,
  )

  const runtime = await helpers.resolveNodeRuntime()
  check(
    'managed runtime found via derived home',
    runtime &&
      runtime.mode === 'managed' &&
      runtime.nodePath === nodeBin &&
      runtime.npmPath === npmBin,
    runtime,
  )
}

async function main() {
  await envPathWins()
  await managedViaToolsBin()
  await managedViaReceipt()
  await managedViaDirectoryScan()
  await brokenManagedNodeIsRejectedAndReprobed()
  await homeIsDerivedWithoutEnvironment()

  console.log(
    `\n${failed === 0 ? 'All checks passed.' : `${failed} check(s) failed.`}`,
  )
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
