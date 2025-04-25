/**
 * formatter.js — Prettier⁺ formatter engine for Nova
 *
 * @license MIT
 * @author Alexander Weiss, Toni Förster
 * @copyright © 2023 Alexander Weiss, © 2025 Toni Förster
 *
 * Provides the core formatting logic and manages communication with the background Prettier service.
 */

const {
  showError,
  showActionableError,
  log,
  getConfigWithWorkspaceOverride,
} = require('./helpers.js')

const pluginPaths = require('./prettier-plugins.js')

const {
  getDefaultConfig,
  getAstroConfig,
  getBladeConfig,
  getLiquidConfig,
  getNginxConfig,
  getNodeSqlParserConfig,
  getPhpConfig,
  getPropertiesConfig,
  getSqlFormatterConfig,
  getTailwindConfig,
  getXmlConfig,
} = require('./prettier-config.js')

const { detectSyntax } = require('./syntax.js')

const {
  getSqlDialectFromUriOrSyntax,
  getSqlParserDialect,
} = require('./sql.js')

class Formatter {
  constructor() {
    this.prettierServiceDidExit = this.prettierServiceDidExit.bind(this)
    this.prettierServiceStartDidFail =
      this.prettierServiceStartDidFail.bind(this)

    this.emitter = new Emitter()

    this.setupIsReadyPromise()
  }

  get defaultConfig() {
    return getDefaultConfig()
  }

  get astroConfig() {
    return getAstroConfig()
  }

  get bladeConfig() {
    return getBladeConfig()
  }

  get liquidConfig() {
    return getLiquidConfig()
  }

  get nginxConfig() {
    return getNginxConfig()
  }

  get nodeSqlParserConfig() {
    return getNodeSqlParserConfig()
  }

  get phpConfig() {
    return getPhpConfig()
  }

  get propertiesConfig() {
    return getPropertiesConfig()
  }

  get sqlFormatterConfig() {
    return getSqlFormatterConfig()
  }

  get tailwindConfig() {
    return getTailwindConfig()
  }

  get xmlConfig() {
    return getXmlConfig()
  }

  /**
   * Returns the “true” syntax key by combining Nova’s
   * document.syntax with our extension‑based fallback.
   */
  getSyntaxKey(editor) {
    return detectSyntax({
      syntax: editor.document.syntax,
      uri: editor.document.uri,
    })
  }

  get isReady() {
    if (!this._isReadyPromise) {
      this.showServiceNotRunningError()
      return false
    }

    return this._isReadyPromise
  }

  async start(modulePath) {
    if (modulePath) this.modulePath = modulePath

    if (!this._isReadyPromise) this.setupIsReadyPromise()
    // If we're currently stopping we'll wait for that to complete before starting
    if (this._isStoppedPromise) {
      await this._isStoppedPromise
    }

    if (this.prettierService) return
    log.info('Starting Prettier service')

    this.prettierService = new Process('/usr/bin/env', {
      args: [
        'node',
        nova.path.join(
          nova.extension.path,
          'Scripts',
          'prettier-service',
          'prettier-service.js',
        ),
        this.modulePath,
      ],
      stdio: 'jsonrpc',
      cwd: nova.workspace.path,
    })
    this.prettierService.onDidExit(this.prettierServiceDidExit)
    this.prettierService.onNotify('didStart', () => {
      this._resolveIsReadyPromise(true)
    })
    this.prettierService.onNotify(
      'startDidFail',
      this.prettierServiceStartDidFail,
    )
    this.prettierService.start()
  }

  stop() {
    nova.notifications.cancel('prettier-not-running')
    if (!this._isReadyPromise || !this.prettierService) return
    if (this._isStoppedPromise) return

    log.info('Stopping Prettier service')

    this._isStoppedPromise = new Promise((resolve) => {
      this._resolveIsStoppedPromise = resolve
    })

    // Stop processing things
    if (this._resolveIsReadyPromise) this._resolveIsReadyPromise(false)
    this._isReadyPromise = null
    // Actually terminate
    this.prettierService.terminate()
    this.prettierService = null

    return this._isStoppedPromise
  }

  setupIsReadyPromise() {
    this._isReadyPromise = new Promise((resolve) => {
      this._resolveIsReadyPromise = resolve
    })
  }

  prettierServiceDidExit(exitCode) {
    if (this._resolveIsStoppedPromise) {
      this._resolveIsStoppedPromise()
      this._isStoppedPromise = null
    }
    if (!this.prettierService) return

    log.error(`Prettier service exited with code ${exitCode}`)

    if (this._resolveIsReadyPromise) this._resolveIsReadyPromise(false)
    this._isReadyPromise = null
    this.prettierService = null

    if (this.prettierServiceCrashedRecently) {
      return this.showServiceNotRunningError()
    }

    this.prettierServiceCrashedRecently = true
    setTimeout(() => (this.prettierServiceCrashedRecently = false), 5000)

    this.start()
  }

  prettierServiceStartDidFail({ parameters: error }) {
    this._resolveIsReadyPromise(false)

    showActionableError(
      'prettier-not-running',
      nova.localize(
        'prettier.notification.could-not-load-prettier.title',
        'Can’t Load Prettier',
        'notification',
      ),
      nova.localize(
        'prettier.notification.could-not-load-prettier.body',
        "Please ensure your Node.js installation is up to date. Additionally, check if the 'Prettier module' path is correctly set in your extension or project settings. For more details, refer to the error log in the Extension Console.",
        'notification',
      ),
      [
        nova.localize(
          'prettier.notification.could-not-load-prettier.action.project',
          'Project Settings',
          'notification',
        ),
        nova.localize(
          'prettier.notification.could-not-load-prettier.action.extension',
          'Extension Settings',
          'notification',
        ),
      ],
      (r) => {
        switch (r) {
          case 0:
            nova.workspace.openConfig()
            break
          case 1:
            nova.openConfig()
            break
        }
      },
    )

    log.error(`${error.name}: ${error.message}\n${error.stack}`)
  }

  showServiceNotRunningError() {
    showActionableError(
      'prettier-not-running',
      nova.localize(
        'prettier.notification.stopped-running.title',
        'Prettier Stopped Running',
        'notification',
      ),
      nova.localize(
        'prettier.notification.stopped-running.body',
        'If this problem persists, please report the issue through the Extension Library.',
        'notification',
      ),
      [
        nova.localize(
          'prettier.notification.stopped-running.action.restart',
          'Restart Prettier',
          'notification',
        ),
      ],
      (r) => {
        switch (r) {
          case 0:
            this.start()
            break
        }
      },
    )
  }

  async formatEditorForced(editor) {
    return this.formatEditor(editor, false, false, { force: true })
  }

  async formatEditor(editor, saving, selectionOnly, flags = {}) {
    const { document } = editor

    const syntaxKey = this.getSyntaxKey(editor)
    log.debug(`Resolved Syntax Key: ${syntaxKey}`)

    nova.notifications.cancel('prettier-unsupported-syntax')

    // Read the custom config file path from settings.
    const customConfigFile = getConfigWithWorkspaceOverride(
      'prettier.config.file',
    )

    let customFileConfig = {}

    // If a custom config file path is provided, use Nova's file handling.
    if (customConfigFile) {
      try {
        const file = await nova.fs.open(customConfigFile, 'r')
        // Read all lines and join them with newline characters.
        const lines = await file.readlines()
        file.close()
        const fileContent = lines.join('\n')
        // Parse the JSON content into an object.
        customFileConfig = JSON.parse(fileContent)
        log.info('Custom configuration loaded successfully:')
      } catch (error) {
        log.error(
          `Error reading or parsing custom config file at "${customConfigFile}": ${error}`,
        )
      }
    }

    const pathForConfig = document.path || nova.workspace.path
    const shouldApplyDefaultConfig = await this.shouldApplyDefaultConfig(
      syntaxKey,
      document,
      saving,
      pathForConfig,
    )
    if (shouldApplyDefaultConfig === null && !flags.force) return []

    // Retrieve the ignore flag and custom config file settings:
    const ignoreConfigFile = getConfigWithWorkspaceOverride(
      'prettier.config.ignore',
    )

    log.debug(`[Forced=${flags.force}] Formatting ${document.path}`)
    log.debug(`Document Syntax: ${syntaxKey}`)
    log.debug(`Document URI: ${document.uri}`)

    const documentRange = new Range(0, document.length)
    const original = editor.getTextInRange(documentRange)

    // Check if plugins are enabled
    const astroPluginEnabled = getConfigWithWorkspaceOverride(
      'prettier.plugins.prettier-plugin-astro.enabled',
    )

    const bladePluginEnabled = getConfigWithWorkspaceOverride(
      'prettier.plugins.prettier-plugin-blade.enabled',
    )

    const ejsPluginEnabled = getConfigWithWorkspaceOverride(
      'prettier.plugins.prettier-plugin-ejs.enabled',
    )

    const ejsTailwindPluginEnabled = getConfigWithWorkspaceOverride(
      'prettier.plugins.prettier-plugin-ejs-tailwindcss.enabled',
    )

    const javaPluginEnabled = getConfigWithWorkspaceOverride(
      'prettier.plugins.prettier-plugin-java.enabled',
    )

    const liquidPluginEnabled = getConfigWithWorkspaceOverride(
      'prettier.plugins.prettier-plugin-liquid.enabled',
    )

    const nginxPluginEnabled = getConfigWithWorkspaceOverride(
      'prettier.plugins.prettier-plugin-nginx.enabled',
    )

    const phpPluginEnabled = getConfigWithWorkspaceOverride(
      'prettier.plugins.prettier-plugin-php.enabled',
    )

    const propertiesPluginEnabled = getConfigWithWorkspaceOverride(
      'prettier.plugins.prettier-plugin-properties.enabled',
    )

    /// Retrieve the configured SQL formatter type
    const sqlFormatter = getConfigWithWorkspaceOverride(
      'prettier.plugins.prettier-plugin-sql.formatter',
    )

    const sqlPluginEnabled = getConfigWithWorkspaceOverride(
      'prettier.plugins.prettier-plugin-sql.enabled',
    )

    const tailwindSyntaxesEnabled = getConfigWithWorkspaceOverride(
      `prettier.plugins.prettier-plugin-tailwind.syntaxes.${syntaxKey}`,
    )

    const tailwindPluginEnabled = getConfigWithWorkspaceOverride(
      'prettier.plugins.prettier-plugin-tailwind.enabled',
    )

    const xmlPluginEnabled = getConfigWithWorkspaceOverride(
      'prettier.plugins.prettier-plugin-xml.enabled',
    )

    // Initialize plugins array and conditionally load plugins if enabled
    let plugins = []
    if (this.modulePath.includes(nova.extension.path)) {
      if (syntaxKey === 'astro' && astroPluginEnabled) {
        plugins.push(pluginPaths.astro)
      }

      if (syntaxKey === 'blade' && bladePluginEnabled) {
        plugins.push(pluginPaths.blade)
      }

      if (syntaxKey === 'java' && javaPluginEnabled) {
        plugins.push(pluginPaths.java)
      }

      if (syntaxKey === 'java-properties' && propertiesPluginEnabled) {
        plugins.push(pluginPaths.properties)
      }

      if (
        (syntaxKey === 'liquid-html' || syntaxKey === 'liquid-md') &&
        liquidPluginEnabled
      ) {
        plugins.push(pluginPaths.liquid)
      }

      if (syntaxKey === 'nginx' && nginxPluginEnabled) {
        plugins.push(pluginPaths.nginx)
      }

      if (syntaxKey === 'php' && phpPluginEnabled) {
        plugins.push(pluginPaths.php)
      }

      if (syntaxKey === 'sql' && sqlPluginEnabled) {
        plugins.push(pluginPaths.sql)
      }

      if (syntaxKey === 'xml' && xmlPluginEnabled) {
        plugins.push(pluginPaths.xml)
      }

      // prettier-plugin-tailwindcss must be loaded last.
      // See: https://github.com/tailwindlabs/prettier-plugin-tailwindcss#compatibility-with-other-prettier-plugins
      if (tailwindSyntaxesEnabled && tailwindPluginEnabled) {
        plugins.push(pluginPaths.tailwind)
      }

      // Pick the right ejs plugin
      // When using prettier-plugin-ejs-tailwindcss it must be loaded after prettier-plugin-tailwindcss.
      if (syntaxKey === 'html+ejs' || syntaxKey === 'html') {
        const useTailwindEJS =
          tailwindPluginEnabled &&
          tailwindSyntaxesEnabled &&
          ejsTailwindPluginEnabled

        if (useTailwindEJS) {
          plugins.push(pluginPaths.ejsTailwind)
        } else if (ejsPluginEnabled) {
          plugins.push(pluginPaths.ejs)
        }
      }
    }

    const options = {
      parser: this.getParserForSyntax(syntaxKey),
      ...(plugins.length > 0 ? { plugins } : {}),
      ...(document.path ? { filepath: document.path } : {}),
      ...(customConfigFile
        ? customFileConfig
        : ignoreConfigFile || shouldApplyDefaultConfig
          ? this.defaultConfig
          : {}),
      ...(selectionOnly
        ? {
            rangeStart: editor.selectedRange.start,
            rangeEnd: editor.selectedRange.end,
          }
        : {}),
      // Pass the flag to the Prettier service so it knows to ignore external config.
      _ignoreConfigFile: ignoreConfigFile,
      _customConfigFile: customConfigFile,
    }

    // Apply plugin options only if no config is found or it’s intentionally ignored.
    if (!customConfigFile && (ignoreConfigFile || shouldApplyDefaultConfig)) {
      // Add ASTRO plugin options if the document syntax is ASTRO
      if (syntaxKey === 'astro') {
        Object.assign(options, this.astroConfig)
      }

      // Add BLADE plugin options if the document syntax is BLADE
      if (syntaxKey === 'blade') {
        Object.assign(options, this.bladeConfig)
      }

      // Add PROPERTIES plugin options if the document syntax is JAVA-PROPERTIES
      if (syntaxKey === 'java-properties') {
        Object.assign(options, this.propertiesConfig)
      }

      // Add LIQUID plugin options if the document syntax is LIQUID
      if (syntaxKey === 'liquid-html' || syntaxKey === 'liquid-md') {
        Object.assign(options, this.liquidConfig)
      }

      // Add NGINX plugin options if the document syntax is NGINX
      if (syntaxKey === 'nginx') {
        Object.assign(options, this.nginxConfig)
      }

      // Add PHP plugin options if the document syntax is PHP
      if (syntaxKey === 'php') {
        Object.assign(options, this.phpConfig)
      }

      // Add SQL plugin options if the document syntax is SQL
      if (syntaxKey === 'sql') {
        if (sqlFormatter === 'sql-formatter') {
          const config = { ...this.sqlFormatterConfig }

          if (config.language === 'auto') {
            config.language = getSqlDialectFromUriOrSyntax(
              document.uri,
              document.syntax,
            )
            log.debug(`Auto-detected SQL dialect: ${config.language}`)
          }

          Object.assign(options, config)
        } else if (sqlFormatter === 'node-sql-parser') {
          const config = { ...this.nodeSqlParserConfig }

          if (config.database === 'auto') {
            config.database = getSqlParserDialect(document.uri, document.syntax)
            log.debug(`Using node-sql-parser dialect: ${config.database}`)
          }

          Object.assign(options, config)
        }
      }

      // Add TAILWIND plugin options if the document syntax is of a supported type
      // and the plugin is enabled
      if (tailwindSyntaxesEnabled && tailwindPluginEnabled) {
        Object.assign(options, this.tailwindConfig)
      }

      // Add XML plugin options if the document syntax is XML
      if (syntaxKey === 'xml') {
        Object.assign(options, this.xmlConfig)
      }
    }

    // Log the options being used
    log.debug('Prettier options:', JSON.stringify(options, null, 2))

    const result = await this.prettierService.request('format', {
      original,
      pathForConfig,
      ignorePath: flags.force ? null : this.getIgnorePath(pathForConfig),
      options: {
        ...options,
        cursorOffset: editor.selectedRange.start, // send cursor position
      },
      withCursor: true, // signal that we want formatWithCursor
    })

    const {
      formatted,
      error,
      ignored,
      missingParser,
      cursorOffset: newCursor,
    } = result
    this._cursorOffset = newCursor

    if (error) {
      return this.issuesFromPrettierError(error)
    }

    if (ignored) {
      log.debug(`Prettier is configured to ignore ${document.path}`)
      return []
    }

    if (missingParser) {
      if (!saving) {
        showError(
          'prettier-unsupported-syntax',
          nova.localize(
            'prettier.notification.unsupportedSyntax.title',
            'Unsupported Syntax',
            'notification',
          ),
          nova.localize(
            'prettier.notification.missingParser.body',
            'Prettier can’t format this file — no parser is available for its type.',
            'notification',
          ),
        )
      }
      log.debug(`No parser for ${document.path}`)
      return []
    }

    if (formatted === original) {
      log.debug(`No changes for ${document.path}`)
      return []
    }

    await this.applyResult(editor, original, formatted)
  }

  async shouldApplyDefaultConfig(syntaxKey, document, saving, pathForConfig) {
    // Don't format-on-save ignore syntaxes.
    if (
      saving &&
      getConfigWithWorkspaceOverride(
        `prettier.format-on-save.ignored-syntaxes.${syntaxKey}`,
      ) === true
    ) {
      log.debug(`Not formatting (${syntaxKey} syntax ignored) ${document.path}`)
      return null
    }

    let hasConfig = false

    if (document.isRemote) {
      // Don't format-on-save remote documents if they're ignored.
      if (
        saving &&
        getConfigWithWorkspaceOverride('prettier.format-on-save.ignore-remote')
      ) {
        return null
      }
    } else {
      // Try to resolve configuration using Prettier for non-remote documents.
      hasConfig = await this.prettierService.request('hasConfig', {
        pathForConfig,
      })

      if (
        !hasConfig &&
        saving &&
        getConfigWithWorkspaceOverride(
          'prettier.format-on-save.ignore-without-config',
        )
      ) {
        return null
      }
    }

    return !hasConfig
  }

  getIgnorePath(path) {
    const expectedIgnoreDir = nova.workspace.path || nova.path.dirname(path)
    return nova.path.join(expectedIgnoreDir, '.prettierignore')
  }

  getParserForSyntax(syntax) {
    switch (syntax) {
      case 'javascript':
      case 'jsx':
        return 'babel'
      case 'tsx':
        return 'typescript'
      case 'flow':
        return 'babel-flow'
      case 'java-properties':
        return 'dot-properties'
      case 'liquid-html':
      case 'liquid-md':
        return 'liquid-html-ast'
      case 'html+erb':
      case 'html+ejs':
        return 'html'
      default:
        return syntax
    }
  }

  async applyResult(editor, original, formatted) {
    log.info(`Applying formatted changes to ${editor.document.path}`)

    const documentRange = new Range(0, editor.document.length)

    await editor.edit((e) => {
      e.replace(documentRange, formatted)
    })

    const cursorOffset =
      this._cursorOffset != null ? this._cursorOffset : editor.selectedRange.end

    editor.selectedRanges = [new Range(cursorOffset, cursorOffset)]
    editor.scrollToPosition(cursorOffset)
  }

  async replace(editor, formatted) {
    const { document } = editor

    const cursorPosition = editor.selectedRange.end
    const documentRange = new Range(0, document.length)

    await editor.edit((e) => {
      e.replace(documentRange, formatted)
    })

    editor.selectedRanges = [new Range(cursorPosition, cursorPosition)]
  }

  issuesFromPrettierError(error) {
    // If the error doesn't have a message just ignore it.
    if (typeof error.message !== 'string') return []

    if (error.name === 'UndefinedParserError') throw error

    // See if it's a simple error
    let lineData = error.message.match(/\((\d+):(\d+)\)\n/m)
    // See if it's a visual error
    if (!lineData) {
      lineData = error.message.match(/^>\s*?(\d+)\s\|\s/m)
      if (lineData) {
        const columnData = error.message.match(/^\s+\|(\s+)\^+($|\n)/im)
        lineData[2] = columnData ? columnData[1].length + 1 : 0
      }
    }

    if (!lineData) {
      throw error
    }

    const issue = new Issue()
    issue.message = error.stack
      ? error.message
      : error.message.split(/\n\s*?at\s+/i)[0] // When error is only a message it probably has the stack trace appended. Remove it.
    issue.severity = IssueSeverity.Error
    issue.line = lineData[1]
    issue.column = lineData[2]

    return [issue]
  }
}

module.exports = {
  Formatter,
}
