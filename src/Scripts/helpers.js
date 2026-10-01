/**
 * helpers.js — Utility functions for Prettier⁺ for Nova
 *
 * @license MIT
 * @author Alexander Weiss, Toni Förster
 * @copyright © 2023 Alexander Weiss, © 2025 Toni Förster
 *
 * Contains shared functions for config observation, logging, error handling, and config sanitation.
 */

const { showNotification } = require('./notifications.js')

class ProcessError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

/**
 * Extract a filesystem‑style path from any Nova Document URI.
 * Supports file://, sftp://, ssh://, etc.; falls back to raw URI if parsing fails.
 *
 * @param {string} uri  Nova document URI
 * @returns {string}    Extracted file path
 */
function extractPath(uri) {
  try {
    const url = new URL(uri)
    try {
      return decodeURIComponent(url.pathname)
    } catch {
      // Malformed percent-sequence — keep raw pathname
      return url.pathname
    }
  } catch {
    return uri
  }
}

function getConfigWithWorkspaceOverride(name) {
  const workspaceConfig = nova.workspace.config.get(name)
  const extensionConfig = nova.config.get(name)

  return workspaceConfig === null ? extensionConfig : workspaceConfig
}

/**
 * Wrap a function so its first invocation is swallowed and later
 * invocations are forwarded. Nova config observers fire once with the
 * current value on registration — that initial notification must not
 * reach the callback; only real changes should.
 *
 * @param {Function} fn
 * @returns {Function}
 */
function skipInitialCall(fn) {
  let skipped = false
  return function (...args) {
    if (!skipped) {
      skipped = true
      return
    }
    fn.apply(this, args)
  }
}

/**
 * Observe a config key in both workspace and extension, skipping each
 * observer's initial "current value" notification so only real changes
 * reach the callback. Returns the two Disposables so callers can dispose
 * them later.
 */
function observeConfigWithWorkspaceOverride(name, fn) {
  // Each observer fires once with the current value on registration, so
  // each gets its own skipInitialCall wrapper — a shared flag would let
  // the second initial call leak through.
  const workspaceDisposable = nova.workspace.config.observe(
    name,
    skipInitialCall(fn),
  )
  const extensionDisposable = nova.config.observe(name, skipInitialCall(fn))

  return [workspaceDisposable, extensionDisposable]
}

/**
 * For each key in `keys`, observe both workspace & extension overrides.
 * If the override ever becomes an empty array, remove it so Prettier
 * falls back to its built‑in default.
 *
 * @param {string[]} keys
 * @param {Disposable[]} disposables  — an array to collect the returned Disposables
 */
function observeEmptyArrayCleanup(keys, disposables) {
  keys.forEach((key) => {
    disposables.push(
      ...observeConfigWithWorkspaceOverride(key, () => {
        const val = getConfigWithWorkspaceOverride(key)
        if (Array.isArray(val) && val.length === 0) {
          nova.workspace.config.remove(key)
        }
      }),
    )
  })
}

/**
 * Wire up rejection/resolution for a Nova Process based on its stderr
 * and exit status, with an optional inactivity-free timeout so a hung
 * child process can't block the caller forever.
 *
 * @param {Process} process
 * @param {Function} reject
 * @param {Function} resolve
 * @param {number} [timeoutMs=30000]  – 0 disables the timeout
 */
function handleProcessResult(process, reject, resolve, timeoutMs = 30000) {
  const errors = []
  let settled = false

  const settle = (fn, value) => {
    if (settled) return
    settled = true
    fn(value)
  }

  process.onStderr((err) => {
    errors.push(err)
  })

  process.onDidExit((status) => {
    if (status === 0) {
      settle(resolve)
      return
    }

    settle(reject, new ProcessError(status, errors.join('\n')))
  })

  if (timeoutMs > 0) {
    setTimeout(() => {
      if (settled) return
      try {
        process.terminate()
      } catch {
        // already exited
      }
      settle(
        reject,
        new ProcessError(-1, `Process timed out after ${timeoutMs}ms`),
      )
    }, timeoutMs)
  }
}

/**
 * Mirrors the gate inside log.debug so callers can skip building
 * expensive debug payloads (e.g. JSON.stringify of large objects)
 * when they would only be discarded anyway.
 *
 * @returns {boolean}
 */
function isDebugLoggingEnabled() {
  return (
    nova.inDevMode() ||
    getConfigWithWorkspaceOverride('prettier.debug.logging') === true
  )
}

const log = Object.fromEntries(
  ['log', 'info', 'warn', 'error', 'debug'].map((fn) => [
    fn,
    (...args) => {
      if (fn === 'debug') {
        if (!isDebugLoggingEnabled()) return
        return console.log(...args)
      }
      return console[fn](...args)
    },
  ]),
)

async function sanitizePrettierConfig() {
  // Nothing to sanitize without an open workspace — building the path
  // from a null workspace path would throw inside nova.fs.open.
  if (!nova.workspace.path) {
    log.debug('No workspace open — skipping Prettier config sanitation.')
    return
  }

  try {
    const configPath = nova.workspace.path + '/.nova/Configuration.json'

    // nova.fs.open throws on a missing file — most workspaces never
    // create one, so check first and stay quiet instead of warn-logging
    // on every activation.
    if (!nova.fs.stat(configPath)) {
      log.debug(
        'No .nova/Configuration.json — skipping Prettier config sanitation.',
      )
      return
    }

    const file = nova.fs.open(configPath)
    if (!file) {
      log.debug('Could not open .nova/Configuration.json')
      return
    }

    let json
    try {
      json = JSON.parse(await file.read())
    } finally {
      file.close()
    }

    let modified = false

    for (const [key, value] of Object.entries(json)) {
      if (!key.startsWith('prettier.')) continue

      if (value === 'Enable' || value === 'Enabled') {
        nova.workspace.config.set(key, true)
        modified = true
        log.debug(`Key ${key} set to true`)
      } else if (value === 'Disable' || value === 'Disabled') {
        nova.workspace.config.set(key, false)
        modified = true
        log.debug(`Key ${key} set to false`)
      } else if (value === 'Global Default' || value === 'Globale Setting') {
        nova.workspace.config.remove(key)
        modified = true
        log.debug(`Key ${key} removed`)
      }
    }

    if (modified) {
      log.info('Prettier configuration sanitized successfully.')
      await showNotification({
        id: 'prettier-config-updated',
        title: nova.localize(
          'prettier.notification.config.updated.title',
          'Project Configuration Updated',
          'notification',
        ),
        body: nova.localize(
          'prettier.notification.config.updated.body',
          'Your project’s Prettier configuration has been updated to the new config format.',
          'notification',
        ),
      })
      log.info('Notification sent.')
    } else {
      log.debug('Prettier configuration is already sanitized.')
    }
  } catch (err) {
    log.warn('Error while sanitizing Prettier configuration', err)
  }
}

function debouncePromise(fn, timeoutMs) {
  let timer = null

  const debounced = (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      // Fire-and-forget: callers never await debounced(), so rejections
      // are logged instead of leaking as unhandled rejections. The
      // .then() also converts sync throws from fn into logged rejections.
      Promise.resolve()
        .then(() => fn(...args))
        .catch((err) => log.error('Debounced task failed:', err))
    }, timeoutMs)
  }

  debounced.cancel = () => {
    clearTimeout(timer)
    timer = null
  }

  return debounced
}

/**
 * Checks whether a path reported by a FileSystemWatcher lies inside the
 * extension bundle. Events from there are the extension's own doing
 * (the bundled npm install writes into the bundle) and must not trigger
 * service restarts.
 *
 * Watcher callbacks report either absolute paths or paths relative to
 * the watched workspace. Relative paths resolve against the workspace —
 * deliberately NOT against the extension directory, since a generic
 * `package.json` event would then be attributed to the bundle in every
 * window, dropping genuine user triggers.
 *
 * Containment is a plain string-prefix comparison instead of
 * nova.path.relative(): the runtime's relative() can normalize via
 * symlinks and then report "outside" for paths that are clearly inside
 * (observed live). The operands here are always clean, absolute,
 * same-volume paths, and no watch pattern can produce `..` segments.
 *
 * With no usable path at all the filter declines to match, so callers
 * keep their previous behavior instead of losing events.
 *
 * @param {string} filePath – path as passed to the watcher callback
 * @returns {boolean}
 */
function isInsideExtensionBundle(filePath) {
  if (!filePath || typeof filePath !== 'string') return false

  const extensionPath = nova.extension.path
  if (!extensionPath) return false

  // Defensive: tolerate a trailing separator on the bundle path.
  const bundleRoot = extensionPath.endsWith('/')
    ? extensionPath.slice(0, -1)
    : extensionPath

  let candidate
  if (nova.path.isAbsolute(filePath)) {
    candidate = filePath
  } else {
    if (!nova.workspace.path) return false
    candidate = nova.path.join(nova.workspace.path, filePath)
  }

  return candidate === bundleRoot || candidate.startsWith(`${bundleRoot}/`)
}

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
 * Reads and parses a JSON file, resolving null on any error.
 *
 * @param {string} path
 * @returns {object|null}
 */
function readJsonFile(path) {
  try {
    const file = nova.fs.open(path, 'r')
    try {
      return JSON.parse(file.read())
    } finally {
      file.close()
    }
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
  debouncePromise,
  extractPath,
  getCliVersion,
  getConfigWithWorkspaceOverride,
  getNodeVersion,
  getNpmVersion,
  handleProcessResult,
  isDebugLoggingEnabled,
  isInsideExtensionBundle,
  log,
  observeConfigWithWorkspaceOverride,
  observeEmptyArrayCleanup,
  readJsonFile,
  resolveNodeRuntime,
  sanitizePrettierConfig,
  spawnNode,
  spawnNpm,
}
