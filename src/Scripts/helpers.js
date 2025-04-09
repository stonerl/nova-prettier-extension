class ProcessError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

function showError(id, title, body) {
  let request = new NotificationRequest(id)

  request.title = nova.localize(title)
  request.body = nova.localize(body)
  request.actions = [nova.localize('OK')]

  nova.notifications.add(request).catch((err) => console.error(err, err.stack))
}

function showActionableError(id, title, body, actions, callback) {
  let request = new NotificationRequest(id)

  request.title = nova.localize(title)
  request.body = nova.localize(body)
  request.actions = actions.map((action) => nova.localize(action))

  nova.notifications
    .add(request)
    .then((response) => callback(response.actionIdx))
    .catch((err) => console.error(err, err.stack))
}

function getConfigWithWorkspaceOverride(name) {
  const workspaceConfig = nova.workspace.config.get(name)
  const extensionConfig = nova.config.get(name)

  return workspaceConfig === null ? extensionConfig : workspaceConfig
}

function pluginEnabled(syntax) {
  const key = `prettier.plugins.prettier-plugin-${
    syntax === 'java-properties' ? 'properties' : syntax
  }.enabled`
  return getConfigWithWorkspaceOverride(key)
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
  ['log', 'info', 'warn'].map((fn) => [
    fn,
    (...args) => {
      if (
        !nova.inDevMode() &&
        !getConfigWithWorkspaceOverride('prettier.debug.logging')
      ) {
        return
      }
      console[fn](...args)
    },
  ]),
)

// Sanitize Prettier Config Function using Nova's File API with correct mode strings
async function sanitizePrettierConfig() {
  const configPath = nova.workspace.path + '/.nova/Configuration.json'
  console.info('Config Path:', configPath)

  let rawConfig = ''
  try {
    // Open the file for reading using "r" mode
    let file = await nova.fs.open(configPath, 'r')
    rawConfig = await file.read()
    file.close()
    console.info('Configuration file read successfully.')
  } catch (error) {
    console.warn(
      'Prettier configuration file not found or cannot be read:',
      configPath,
      error,
    )
    return
  }

  try {
    console.info('Raw configuration:', rawConfig)
    const config = JSON.parse(rawConfig)
    let modified = false

    for (const key in config) {
      if (key.startsWith('prettier.')) {
        const value = config[key]
        console.info(`Processing key: ${key} with value: ${value}`)
        if (value === 'Enable' || value === 'Enabled') {
          config[key] = true
          modified = true
          console.info(`Key ${key} set to true`)
        } else if (value === 'Disable' || value === 'Disabled') {
          config[key] = false
          modified = true
          console.info(`Key ${key} set to false`)
        } else if (value === 'Global Default' || value === 'Globale Setting') {
          delete config[key]
          modified = true
          console.info(`Key ${key} removed`)
        }
      }
    }

    if (modified) {
      const newContent = JSON.stringify(config, null, 2)
      // Open the file for writing using "w" mode (which truncates the file)
      let file = await nova.fs.open(configPath, 'w')
      await file.write(newContent)
      file.close()
      console.info('Prettier configuration sanitized successfully.')

      // Send a notification if values have been changed.
      let notification = new NotificationRequest('prettier-config-updated')
      notification.title = 'Project Configuration Updated'
      notification.body =
        "Your project's Prettier configuration has been updated to the new config format."
      notification.actions = ['OK']
      await nova.notifications.add(notification)
      console.info('Notification sent.')
    } else {
      console.info('Prettier configuration is already sanitized.')
    }
  } catch (error) {
    console.error('Error sanitizing Prettier configuration:', error)
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
  pluginEnabled,
}
