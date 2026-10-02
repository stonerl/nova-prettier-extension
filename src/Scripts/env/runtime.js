/**
 * runtime.js — Node.js/npm runtime resolution for Prettier⁺ for Nova
 *
 * @license MIT
 * @author Toni Förster
 * @copyright © 2026 Toni Förster
 *
 * Resolves the Node.js runtime used for all subprocesses (PATH lookup
 * with a fallback to Nova's managed tools) and configures node/npm
 * processes on top of it, including the version probes for the
 * Prettier Info dialog.
 */

const { log, readJsonFile } = require('../helpers.js')

// ---------------------------------------------------------------------------
// Node/npm runtime resolution
// ---------------------------------------------------------------------------

/**
 * Determines the user's home directory. Nova doesn't expose a home API,
 * so nova.environment.HOME is used first, with a fallback derived from a
 * released extension's install location
 * (<home>/Library/Application Support/Nova/Extensions).
 *
 * @returns {string|null}
 */
function getHomeDirectory() {
  const environment = nova.environment
  if (environment && typeof environment.HOME === 'string' && environment.HOME) {
    return environment.HOME
  }

  const extensionPath = nova.extension.path || ''
  const marker = '/Library/Application Support/Nova/Extensions'
  const markerIndex = extensionPath.indexOf(marker)
  if (markerIndex > 0) return extensionPath.slice(0, markerIndex)

  return null
}

/**
 * Stats a path, returning the path itself when it exists (stat follows
 * symlinks, so Nova’s `Tools/bin` entries resolve to their targets).
 *
 * @param {string} path
 * @returns {string|null}
 */
function statIfPresent(path) {
  try {
    return nova.fs.stat(path) ? path : null
  } catch {
    return null
  }
}

/**
 * Locates Node.js binaries installed by Nova’s managed-tools system
 * (Settings → Languages), e.g. as a dependency of an npm-based language
 * server. Probed most-specific first:
 *
 * 1. The `Tools/bin/<name>` symlinks Nova creates for every managed tool
 * 2. The per-package `nova-receipt.json`, which records the registry’s
 *    `bin` mapping relative to the package directory
 * 3. A scan of the package directory for `node-<version>-<arch>/bin/node`
 *
 * @returns {{nodePath: string, npmPath: string}|null}
 */
function findManagedNodeBinaries() {
  const home = getHomeDirectory()
  if (!home) return null

  const toolsDirectory = nova.path.join(
    home,
    'Library',
    'Application Support',
    'Nova',
    'Tools',
  )
  const nodePackageDirectory = nova.path.join(
    toolsDirectory,
    'packages',
    'node',
  )

  let nodePath = statIfPresent(nova.path.join(toolsDirectory, 'bin', 'node'))
  let npmPath = statIfPresent(nova.path.join(toolsDirectory, 'bin', 'npm'))

  if (!nodePath || !npmPath) {
    const receipt = readJsonFile(
      nova.path.join(nodePackageDirectory, 'nova-receipt.json'),
    )
    if (receipt && receipt.bin) {
      if (!nodePath && typeof receipt.bin.node === 'string') {
        nodePath = statIfPresent(
          nova.path.join(nodePackageDirectory, receipt.bin.node),
        )
      }
      if (!npmPath && typeof receipt.bin.npm === 'string') {
        npmPath = statIfPresent(
          nova.path.join(nodePackageDirectory, receipt.bin.npm),
        )
      }
    }
  }

  if (!nodePath || !npmPath) {
    try {
      for (const entry of nova.fs.listdir(nodePackageDirectory)) {
        const versionDirectory = nova.path.join(nodePackageDirectory, entry)
        if (!nodePath) {
          nodePath = statIfPresent(
            nova.path.join(versionDirectory, 'bin', 'node'),
          )
        }
        if (!npmPath) {
          npmPath = statIfPresent(
            nova.path.join(versionDirectory, 'bin', 'npm'),
          )
        }
        if (nodePath && npmPath) break
      }
    } catch {
      // No managed Node.js package installed
    }
  }

  if (!nodePath || !npmPath) return null
  return { nodePath, npmPath }
}

/**
 * Runs a process to completion and resolves with its trimmed stdout
 * ('' on non-zero exit or spawn failure).
 *
 * @param {Process} process  – un-started Nova Process
 * @returns {Promise<string>}
 */
function runVersionCheck(process) {
  return new Promise((resolve) => {
    let version = ''

    process.onStdout((chunk) => {
      version += chunk
    })

    process.onDidExit((status) => {
      resolve(status === 0 ? version.trim() : '')
    })

    try {
      process.start()
    } catch (err) {
      log.warn('Failed to spawn version-check process:', err)
      resolve('')
    }
  })
}

/**
 * Probes for a usable Node.js runtime, preferring the PATH lookup
 * (`/usr/bin/env node`) and falling back to Nova’s managed tools.
 * npm is always reported as a plain path — in managed mode it is run
 * through the managed node binary, because npm’s entry script relies on
 * a `#!/usr/bin/env node` shebang, which fails in exactly the scenario
 * this fallback exists for.
 *
 * @returns {Promise<{mode: 'env'|'managed', nodePath: string, npmPath: string, nodeVersion: string}|null>}
 */
async function probeNodeRuntime() {
  const cwd = nova.workspace.path || nova.extension.path

  const envVersion = await runVersionCheck(
    new Process('/usr/bin/env', { args: ['node', '--version'], cwd }),
  )
  if (envVersion) {
    return {
      mode: 'env',
      nodePath: 'node',
      npmPath: 'npm',
      nodeVersion: envVersion,
    }
  }

  const managed = findManagedNodeBinaries()
  if (!managed) return null

  const managedVersion = await runVersionCheck(
    new Process(managed.nodePath, { args: ['--version'], cwd }),
  )
  if (!managedVersion) {
    log.warn(
      `Found Nova-managed Node.js at ${managed.nodePath}, but it failed to run.`,
    )
    return null
  }

  log.info(
    `Using Nova-managed Node.js ${managedVersion} at ${managed.nodePath}`,
  )

  // Doctor note for the "env: mkdir: No such file or directory" /
  // "spawn sh ENOENT" class: a Nova environment PATH without the
  // standard system dirs. managedProcessEnv works around it; knowing
  // the user's PATH made reports actionable without asking for more
  // logs.
  const environmentPATH = nova.environment && nova.environment.PATH
  if (environmentPATH && !environmentPATH.split(':').includes('/bin')) {
    log.warn(
      `Nova's environment PATH lacks the standard /bin directory — ` +
        `spawning system tools may be limited. PATH as seen by Nova: ` +
        `${environmentPATH}`,
    )
  }

  return {
    mode: 'managed',
    nodePath: managed.nodePath,
    npmPath: managed.npmPath,
    nodeVersion: managedVersion,
  }
}

// Cached promise for the runtime lookup — only successful probes are
// cached, so a later managed-Node install is picked up.
let _nodeRuntimePromise = null

/**
 * Resolves (and caches) the Node.js runtime to use for subprocesses.
 *
 * @returns {Promise<{mode: 'env'|'managed', nodePath: string, npmPath: string, nodeVersion: string}|null>}
 *          null when no runtime could be found
 */
function resolveNodeRuntime() {
  if (_nodeRuntimePromise) return _nodeRuntimePromise

  _nodeRuntimePromise = probeNodeRuntime().then((runtime) => {
    if (!runtime) _nodeRuntimePromise = null
    return runtime
  })
  return _nodeRuntimePromise
}

/**
 * Composes the environment for a managed-mode subprocess. npm runs
 * package lifecycle scripts (e.g. postinstall) through `sh -c`, which
 * resolves `sh` on the child's PATH — /bin and /usr/bin are therefore
 * guaranteed present: some users' shell setups leave Nova's environment
 * PATH without the standard system directories, where the plain
 * fallback below never applies (PATH is set, just incomplete). The
 * parent environment's PATH is preserved in its original order — only
 * missing system directories are appended, so healthy setups resolve
 * exactly as before, with the managed install's directory first so
 * `node`/`npm` resolve to the managed tools.
 *
 * @param {string} nodePath  – absolute path to the managed node binary
 * @param {object} [extraEnv] – caller-provided environment overrides
 * @returns {object}
 */
function managedProcessEnv(nodePath, extraEnv) {
  const nodeDirectory = nodePath.slice(0, nodePath.lastIndexOf('/'))
  const basePATH =
    (nova.environment && nova.environment.PATH) ||
    '/usr/bin:/bin:/usr/sbin:/sbin'

  const directories = basePATH.split(':').filter(Boolean)
  for (const directory of ['/usr/bin', '/bin']) {
    if (!directories.includes(directory)) directories.push(directory)
  }

  return {
    ...(extraEnv || {}),
    PATH: `${nodeDirectory}:${directories.join(':')}`,
  }
}

/**
 * Configures an un-started Nova Process running node with the given
 * arguments, preferring the PATH lookup and falling back to Nova’s
 * managed Node.js installation. Throws when no runtime is available.
 *
 * @param {string[]} args        – arguments to pass to node
 * @param {object}   [options]   – additional Process options (cwd, stdio, …)
 * @returns {Promise<Process>}
 */
async function spawnNode(args, options = {}) {
  const runtime = await resolveNodeRuntime()
  if (!runtime) {
    throw new Error(
      'Node.js is neither on PATH nor installed via Nova’s managed tools.',
    )
  }

  if (runtime.mode === 'env') {
    return new Process('/usr/bin/env', { ...options, args: ['node', ...args] })
  }
  return new Process(runtime.nodePath, {
    ...options,
    env: managedProcessEnv(runtime.nodePath, options.env),
    args: [...args],
  })
}

/**
 * Configures an un-started Nova Process running npm with the given
 * arguments, preferring the PATH lookup and falling back to Nova’s
 * managed Node.js installation. Throws when no runtime is available.
 *
 * @param {string[]} args       – arguments to pass to npm
 * @param {object}   [options]  – additional Process options (cwd, …)
 * @returns {Promise<Process>}
 */
async function spawnNpm(args, options = {}) {
  const runtime = await resolveNodeRuntime()
  if (!runtime) {
    throw new Error(
      'npm is neither on PATH nor installed via Nova’s managed tools.',
    )
  }

  if (runtime.mode === 'env') {
    return new Process('/usr/bin/env', { ...options, args: ['npm', ...args] })
  }
  return new Process(runtime.nodePath, {
    ...options,
    env: managedProcessEnv(runtime.nodePath, options.env),
    args: [runtime.npmPath, ...args],
  })
}

// Cache of promises per CLI tool's "--version" lookup — multiple calls
// return the same in-flight/resolved promise, avoiding duplicate spawns.
const _cliVersionPromises = {}

/**
 * Asynchronously fetches (and caches) `<tool> --version`.
 *
 * @param {string} toolName     – the binary to invoke (e.g. "npm", "node")
 * @returns {Promise<string>}   – trimmed stdout, or "unknown" on failure
 */
function getCliVersion(toolName) {
  if (!_cliVersionPromises[toolName]) {
    _cliVersionPromises[toolName] = resolveNodeRuntime()
      .then(async (runtime) => {
        if (!runtime) return 'unknown'

        // The resolver already ran `node --version` during its probe
        if (toolName === 'node') return runtime.nodeVersion

        const version = await runVersionCheck(
          await spawnNpm(['--version'], {
            cwd: nova.workspace.path || nova.extension.path,
          }),
        )
        return version || 'unknown'
      })
      .catch((err) => {
        log.warn(`Failed to determine ${toolName} version:`, err)
        return 'unknown'
      })
  }
  return _cliVersionPromises[toolName]
}

function getNpmVersion() {
  return getCliVersion('npm')
}
function getNodeVersion() {
  return getCliVersion('node')
}

module.exports = {
  getCliVersion,
  getNodeVersion,
  getNpmVersion,
  resolveNodeRuntime,
  spawnNode,
  spawnNpm,
}
