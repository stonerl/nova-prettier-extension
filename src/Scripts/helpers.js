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
    nova.localize(
      'prettier.notification.showErrors.actions',
      'OK',
      'notification',
    ),
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

function observeConfigWithWorkspaceOverride(name, fn) {
  let ignored = false
  function wrapped(...args) {
    if (!ignored) {
      ignored = true
      return
    }
    fn.apply(this, args)
  }
  nova.workspace.config.observe(name, wrapped)
  nova.config.observe(name, wrapped)
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
  log.debug('Config Path:', configPath)

  let rawConfig = ''
  try {
    // Open the file for reading using "r" mode
    let file = await nova.fs.open(configPath, 'r')
    rawConfig = await file.read()
    file.close()
    log.debug('Configuration file read successfully.')
  } catch (error) {
    log.warn(
      'Prettier configuration file not found or cannot be read:',
      configPath,
      error,
    )
    return
  }

  try {
    log.debug('Raw configuration:', rawConfig)
    const config = JSON.parse(rawConfig)
    let modified = false

    for (const key in config) {
      if (key.startsWith('prettier.')) {
        const value = config[key]
        log.debug(`Processing key: ${key} with value: ${value}`)
        if (value === 'Enable' || value === 'Enabled') {
          config[key] = true
          modified = true
          log.debug(`Key ${key} set to true`)
        } else if (value === 'Disable' || value === 'Disabled') {
          config[key] = false
          modified = true
          log.debug(`Key ${key} set to false`)
        } else if (value === 'Global Default' || value === 'Globale Setting') {
          delete config[key]
          modified = true
          log.debug(`Key ${key} removed`)
        }
      }
    }

    if (modified) {
      const newContent = JSON.stringify(config, null, 2)
      // Open the file for writing using "w" mode (which truncates the file)
      let file = await nova.fs.open(configPath, 'w')
      await file.write(newContent)
      file.close()
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
        nova.localize(
          'prettier.notification.config.updated.actions',
          'OK',
          'notification',
        ),
      ]
      await nova.notifications.add(notification)
      log.info('Notification sent.')
    } else {
      log.debug('Prettier configuration is already sanitized.')
    }
  } catch (error) {
    log.error('Error sanitizing Prettier configuration:', error)
  }
}

module.exports = {
  showError,
  showActionableError,
  log,
  getConfigWithWorkspaceOverride,
  observeConfigWithWorkspaceOverride,
  ProcessError,
  handleProcessResult,
  sanitizePrettierConfig,
}
