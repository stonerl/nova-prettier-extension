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
    return new URL(uri).pathname
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
 * reach the callback.
 * Returns the two Disposables so callers can dispose them later.
 */
function observeConfigWithWorkspaceOverride(name, fn) {
  // Each observer fires once with the current value on registration, so
  // each gets its own skipInitialCall wrapper — a shared flag would
  // depend on both observers firing initially and would let the second
  // initial call leak.
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
        // already exited — nothing to terminate
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
        // Gate debug logs: if not in dev mode or debug logging flag is off, do nothing.
        if (!isDebugLoggingEnabled()) {
          return
        }
        // Remap debug to use console.log
        return console.log(...args)
      }
      return console[fn](...args)
    },
  ]),
)

// Sanitize Prettier Config Function using Nova's File API with correct mode strings
async function sanitizePrettierConfig() {
  // Nothing to sanitize without an open workspace — building the path
  // from a null workspace path would throw inside nova.fs.open.
  if (!nova.workspace.path) {
    log.debug('No workspace open — skipping Prettier config sanitation.')
    return
  }

  try {
    const configPath = nova.workspace.path + '/.nova/Configuration.json'

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
      // Send a notification if values have been changed.
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
    // Missing or malformed Configuration.json must never break extension startup.
    log.warn('Error while sanitizing Prettier configuration', err)
  }
}

function debouncePromise(fn, timeoutMs) {
  let timer = null

  const debounced = (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      Promise.resolve(fn(...args)).finally(() => {
        timer = null
      })
    }, timeoutMs)
  }

  debounced.cancel = () => {
    clearTimeout(timer)
    timer = null
  }

  return debounced
}

/**
 * Returns true if the running Nova version is at least the given version.
 *
 * @param {number} major    – required major version
 * @param {number} minor    – optional minor version (defaults to 0)
 * @param {number} patch    – optional patch version (defaults to 0)
 * @returns {boolean}
 */
function minNovaVersion(major, minor = 0, patch = 0) {
  const [a = 0, b = 0, c = 0] = nova.version
  if (a !== major) return a > major
  if (b !== minor) return b > minor
  return c >= patch
}

// Cache of promises for each CLI tool’s “--version” lookup.
// This ensures that multiple calls to getCliVersion('npm') or getCliVersion('node')
// return the same in‐flight or resolved promise, avoiding spawning the process more than once.
const _cliVersionPromises = {}

/**
 * Asynchronously fetches (and caches) `<tool> --version`.
 *
 * @param {string} toolName     – the binary to invoke (e.g. "npm", "node")
 * @returns {Promise<string>}   – trimmed stdout, or "unknown" on failure
 */
function getCliVersion(toolName) {
  if (!_cliVersionPromises[toolName]) {
    _cliVersionPromises[toolName] = new Promise((resolve) => {
      let ver = ''
      const p = new Process('/usr/bin/env', {
        args: [toolName, '--version'],
        cwd: nova.workspace.path || nova.extension.path,
      })

      p.onStdout((chunk) => {
        ver += chunk
      })

      p.onDidExit((status) => {
        if (status === 0) {
          resolve(ver.trim())
        } else {
          log.warn(
            `${toolName} --version exited ${status}, defaulting to "unknown"`,
          )
          resolve('unknown')
        }
      })

      // Catch any errors thrown by start(), e.g. if the binary isn't on PATH
      try {
        p.start()
      } catch (err) {
        log.warn(`Failed to spawn ${toolName} for version check:`, err)
        resolve('unknown')
      }
    })
  }
  return _cliVersionPromises[toolName]
}

/** Convenience wrappers for clarity & backward compatibility */
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
  log,
  minNovaVersion,
  observeConfigWithWorkspaceOverride,
  observeEmptyArrayCleanup,
  ProcessError,
  sanitizePrettierConfig,
}
