/**
 * helpers.js — Utility functions for Prettier⁺ for Nova
 *
 * @license MIT
 * @author Alexander Weiss, Toni Förster
 * @copyright © 2023 Alexander Weiss, © 2025 Toni Förster
 *
 * Contains shared functions for config observation, logging, error handling, and config sanitation.
 */

class ProcessError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

function showError(id, title, body) {
  let request = new NotificationRequest(id)

  request.title = title
  request.body = body
  request.actions = [
    nova.localize('prettier.notification.actions.ok', 'OK', 'notification'),
  ]

  nova.notifications.add(request).catch((err) => log.error(err, err.stack))
}

function showActionableError(id, title, body, actions, callback) {
  let request = new NotificationRequest(id)

  request.title = title
  request.body = body
  request.actions = actions.map((action) => action)

  nova.notifications
    .add(request)
    .then((response) => callback(response.actionIdx))
    .catch((err) => log.error(err, err.stack))
}

function getConfigWithWorkspaceOverride(name) {
  const workspaceConfig = nova.workspace.config.get(name)
  const extensionConfig = nova.config.get(name)

  return workspaceConfig === null ? extensionConfig : workspaceConfig
}

/**
 * Observe a config key in both workspace and extension, but only after
 * the initial “current value” notification.
 * Returns the two Disposables so callers can dispose them later.
 */
function observeConfigWithWorkspaceOverride(name, fn) {
  let skippedInitialCall = false
  function wrapped(...args) {
    if (!skippedInitialCall) {
      // skip the first call (initial value)
      skippedInitialCall = true
      return
    }
    fn.apply(this, args)
  }

  // capture the two Disposables
  const workspaceDisposable = nova.workspace.config.observe(name, wrapped)
  const extensionDisposable = nova.config.observe(name, wrapped)

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

function handleProcessResult(process, reject, resolve) {
  const errors = []
  process.onStderr((err) => {
    errors.push(err)
  })

  process.onDidExit((status) => {
    if (status === 0) {
      if (resolve) resolve()
      return
    }

    reject(new ProcessError(status, errors.join('\n')))
  })
}

const log = Object.fromEntries(
  ['log', 'info', 'warn', 'error', 'debug'].map((fn) => [
    fn,
    (...args) => {
      if (fn === 'debug') {
        // Gate debug logs: if not in dev mode or debug logging flag is off, do nothing.
        if (
          !nova.inDevMode() &&
          !getConfigWithWorkspaceOverride('prettier.debug.logging')
        ) {
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
  const configPath = nova.workspace.path + '/.nova/Configuration.json'

  const file = nova.fs.open(configPath)
  if (!file) {
    log.debug('Could not open .nova/Configuration.json')
    return
  }

  const json = JSON.parse(await file.read())
  file.close()

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
    let notification = new NotificationRequest('prettier-config-updated')
    notification.title = nova.localize(
      'prettier.notification.config.updated.title',
      'Project Configuration Updated',
      'notification',
    )
    notification.body = nova.localize(
      'prettier.notification.config.updated.body',
      'Your project’s Prettier configuration has been updated to the new config format.',
      'notification',
    )
    notification.actions = [
      nova.localize('prettier.notification.actions.ok', 'OK', 'notification'),
    ]
    await nova.notifications.add(notification)
    log.info('Notification sent.')
  } else {
    log.debug('Prettier configuration is already sanitized.')
  }
}

module.exports = {
  showError,
  showActionableError,
  log,
  getConfigWithWorkspaceOverride,
  observeConfigWithWorkspaceOverride,
  observeEmptyArrayCleanup,
  ProcessError,
  handleProcessResult,
  sanitizePrettierConfig,
}
