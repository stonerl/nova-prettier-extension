/**
 * helpers.js — Utility functions for Prettier⁺ for Nova
 *
 * @license MIT
 * @author Alexander Weiss, Toni Förster
 * @copyright © 2023 Alexander Weiss, © 2025 Toni Förster
 *
 * Contains shared functions for config observation, logging, and config sanitation.
 * Subprocess plumbing lives in processes.js, Node.js/npm runtime
 * resolution in runtime.js.
 */

const { showNotification } = require('./notifications.js')

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

module.exports = {
  debouncePromise,
  extractPath,
  getConfigWithWorkspaceOverride,
  isDebugLoggingEnabled,
  isInsideExtensionBundle,
  log,
  observeConfigWithWorkspaceOverride,
  observeEmptyArrayCleanup,
  readJsonFile,
  sanitizePrettierConfig,
}
