const diff = require('fast-diff')
const {
  showError,
  showActionableError,
  log,
  getConfigWithWorkspaceOverride,
} = require('./helpers.js')

const POSSIBLE_CURSORS = String.fromCharCode(
  0xfffd,
  0xffff,
  0x1f094,
  0x1f08d,
  0xe004,
  0x1f08d,
).split('')

const PRETTIER_OPTIONS = [
  'arrowParens',
  'bracketSameLine',
  'bracketSpacing',
  'embeddedLanguageFormatting',
  'endOfLine',
  'htmlWhitespaceSensitivity',
  'insertPragma',
  'jsxBracketSameLine',
  'jsxSingleQuote',
  'objectWrap',
  'printWidth',
  'proseWrap',
  'quoteProps',
  'requirePragma',
  'semi',
  'singleAttributePerLine',
  'singleQuote',
  'tabWidth',
  'trailingComma',
  'useTabs',
  'vueIndentScriptAndStyle',
]

const PRETTIER_PHP_PLUGIN_OPTIONS = [
  'phpVersion',
  'singleQuote',
  'trailingCommaPHP',
  'braceStyle',
]

const PRETTIER_XML_PLUGIN_OPTIONS = [
  'xmlQuoteAttributes',
  'xmlSelfClosingSpace',
  'xmlSortAttributesByKey',
  'xmlWhitespaceSensitivity',
]

const PRETTIER_SQL_PLUGIN_SQL_FORMATTER_OPTIONS = [
  'language',
  'keywordCase',
  'dataTypeCase',
  'functionCase',
  'identifierCase',
  'logicalOperatorNewline',
  'expressionWidth',
  'linesBetweenQueries',
  'denseOperators',
  'newlineBeforeSemicolon',
  'params',
  'paramTypes',
]

const PRETTIER_SQL_PLUGIN_NODE_SQL_PARSER_OPTIONS = ['database', 'type']

const PRETTIER_NGINX_PLUGIN_OPTIONS = [
  'alignDirectives',
  'alignUniversally',
  'wrapParameters',
  'continuationIndent',
]

class Formatter {
  constructor() {
    this.prettierServiceDidExit = this.prettierServiceDidExit.bind(this)
    this.prettierServiceStartDidFail =
      this.prettierServiceStartDidFail.bind(this)

    this.emitter = new Emitter()

    this.setupIsReadyPromise()
  }

  get defaultConfig() {
    return Object.fromEntries(
      PRETTIER_OPTIONS.map((option) => [
        option,
        getConfigWithWorkspaceOverride(`prettier.default-config.${option}`),
      ]),
    )
  }

  get phpConfig() {
    return Object.fromEntries(
      PRETTIER_PHP_PLUGIN_OPTIONS.map((option) => [
        option,
        getConfigWithWorkspaceOverride(
          `prettier.plugins.prettier-plugin-php.${option}`,
        ),
      ]),
    )
  }

  get xmlConfig() {
    return Object.fromEntries(
      PRETTIER_XML_PLUGIN_OPTIONS.map((option) => [
        option,
        getConfigWithWorkspaceOverride(
          `prettier.plugins.prettier-plugin-xml.${option}`,
        ),
      ]),
    )
  }

  get sqlFormatterConfig() {
    return Object.fromEntries(
      PRETTIER_SQL_PLUGIN_SQL_FORMATTER_OPTIONS.map((option) => [
        option,
        getConfigWithWorkspaceOverride(
          `prettier.plugins.prettier-plugin-sql.sql-formatter.${option}`,
        ),
      ]),
    )
  }

  get nginxConfig() {
    return Object.fromEntries(
      PRETTIER_NGINX_PLUGIN_OPTIONS.map((option) => [
        option,
        getConfigWithWorkspaceOverride(
          `prettier.plugins.prettier-plugin-nginx.${option}`,
        ),
      ]),
    )
  }

  get nodeSqlParserConfig() {
    return Object.fromEntries(
      PRETTIER_SQL_PLUGIN_NODE_SQL_PARSER_OPTIONS.map((option) => [
        option,
        getConfigWithWorkspaceOverride(
          `prettier.plugins.prettier-plugin-sql.sql-formatter.${option}`,
        ),
      ]),
    )
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
      await _isStoppedPromise
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

    console.error(`Prettier service exited with code ${exitCode}`)

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
      `Couldn't Load Prettier`,
      `Please ensure your Node.js installation is up to date. Additionally, check if the 'Prettier module' path is correctly set in your extension or project settings. For more details, refer to the error log in the Extension Console`,
      ['Project settings', 'Extension settings'],
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

    console.error(`${error.name}: ${error.message}\n${error.stack}`)
  }

  showServiceNotRunningError() {
    showActionableError(
      'prettier-not-running',
      'Prettier Stopped Running',
      `If this problem persists, please report the issue through the Extension Library.`,
      ['Restart Prettier'],
      (r) => {
        switch (r) {
          case 0:
            this.start()
            break
        }
      },
    )
  }

  async formatEditor(editor, saving, selectionOnly) {
    const { document } = editor

    nova.notifications.cancel('prettier-unsupported-syntax')

    const pathForConfig = document.path || nova.workspace.path

    const shouldApplyDefaultConfig = await this.shouldApplyDefaultConfig(
      document,
      saving,
      pathForConfig,
    )

    if (shouldApplyDefaultConfig === null) return []

    log.info(`Formatting ${document.path}`)

    const documentRange = new Range(0, document.length)
    const original = editor.getTextInRange(documentRange)

    // Check if plugins are enabled
    const phpPluginEnabled = getConfigWithWorkspaceOverride(
      'prettier.plugins.prettier-plugin-php.enabled',
    )
    const sqlPluginEnabled = getConfigWithWorkspaceOverride(
      'prettier.plugins.prettier-plugin-sql.enabled',
    )
    const xmlPluginEnabled = getConfigWithWorkspaceOverride(
      'prettier.plugins.prettier-plugin-xml.enabled',
    )
    const nginxPluginEnabled = getConfigWithWorkspaceOverride(
      'prettier.plugins.prettier-plugin-nginx.enabled',
    )

    /// Retrieve the configured SQL formatter type
    const sqlFormatter = getConfigWithWorkspaceOverride(
      'prettier.plugins.prettier-plugin-sql.formatter',
    )

    // Initialize plugins array and conditionally load plugins if enabled
    let plugins = []
    if (this.modulePath.includes(nova.extension.path)) {
      if (document.syntax === 'php' && phpPluginEnabled) {
        plugins.push(
          nova.path.join(
            nova.extension.path,
            'node_modules',
            '@prettier',
            'plugin-php',
            'src',
            'index.mjs',
          ),
        )
      }
      if (document.syntax === 'sql' && sqlPluginEnabled) {
        plugins.push(
          nova.path.join(
            nova.extension.path,
            'node_modules',
            'prettier-plugin-sql',
            'lib',
            'index.cjs',
          ),
        )
      }
      if (document.syntax === 'xml' && xmlPluginEnabled) {
        plugins.push(
          nova.path.join(
            nova.extension.path,
            'node_modules',
            '@prettier',
            'plugin-xml',
            'src',
            'plugin.js',
          ),
        )
      }
      if (document.syntax === 'nginx' && nginxPluginEnabled) {
        plugins.push(
          nova.path.join(
            nova.extension.path,
            'node_modules',
            'prettier-plugin-nginx',
            'dist',
            'index.js',
          ),
        )
      }
    }

    const options = {
      parser: this.getParserForSyntax(document.syntax),
      ...(plugins.length > 0 ? { plugins } : {}),
      ...(document.path ? { filepath: document.path } : {}),
      ...(shouldApplyDefaultConfig ? this.defaultConfig : {}),
      ...(selectionOnly
        ? {
            rangeStart: editor.selectedRange.start,
            rangeEnd: editor.selectedRange.end,
          }
        : {}),
    }

    // Add PHP plugin options if the document is PHP
    if (document.syntax === 'php') {
      Object.assign(options, this.phpConfig)
    }

    // Add XML plugin options if the document is XML
    if (document.syntax === 'xml') {
      Object.assign(options, this.xmlConfig)
    }

    // Add SQL plugin options if the document is SQL
    if (document.syntax === 'sql') {
      if (sqlFormatter === 'sql-formatter') {
        Object.assign(options, this.sqlFormatterConfig)
      } else if (sqlFormatter === 'node-sql-parser') {
        Object.assign(options, this.nodeSqlParserConfig)
      }
    }

    // Add NGINX plugin options if the document is NGINX
    if (document.syntax === 'nginx') {
      Object.assign(options, this.nginxConfig)
    }

    // Log the options being used
    log.info('Prettier options:', JSON.stringify(options, null, 2))

    const result = await this.prettierService.request('format', {
      original,
      pathForConfig,
      ignorePath: saving && this.getIgnorePath(pathForConfig),
      options,
    })

    const { formatted, error, ignored, missingParser } = result

    if (error) {
      return this.issuesFromPrettierError(error)
    }

    if (ignored) {
      log.info(`Prettier is configured to ignore ${document.path}`)
      return []
    }

    if (missingParser) {
      if (!saving) {
        showError(
          'prettier-unsupported-syntax',
          `Syntax Not Supported`,
          `Prettier doesn't include a parser for this file, and no installed plugin provides one.`,
        )
      }
      log.info(`No parser for ${document.path}`)
      return []
    }

    if (formatted === original) {
      log.info(`No changes for ${document.path}`)
      return []
    }

    await this.applyResult(editor, original, formatted)
  }

  async shouldApplyDefaultConfig(document, saving, pathForConfig) {
    // Don't format-on-save ignore syntaxes.
    if (
      saving &&
      getConfigWithWorkspaceOverride(
        `prettier.format-on-save.ignored-syntaxes.${document.syntax}`,
      ) === true
    ) {
      log.info(
        `Not formatting (${document.syntax} syntax ignored) ${document.path}`,
      )
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
      case 'html+erb':
        return 'erb'
      default:
        return syntax
    }
  }

  async applyResult(editor, original, formatted) {
    log.info(`Applying formatted changes to ${editor.document.path}`)

    const [cursor, edits] = this.diff(
      original,
      formatted,
      editor.selectedRanges,
    )

    if (
      original !== editor.getTextInRange(new Range(0, editor.document.length))
    ) {
      log.info(`Document ${editor.document.path} was changed while formatting`)
      return
    }

    if (edits) {
      return this.applyDiff(editor, cursor, edits)
    }

    return this.replace(editor, formatted)
  }

  diff(original, formatted, selectedRanges) {
    // Find a cursor that does not occur in this document
    const cursor = POSSIBLE_CURSORS.find(
      (cursor) => !original.includes(cursor) && !formatted.includes(cursor),
    )
    // Fall back to not knowing the cursor position.
    if (!cursor) return null

    let originalWithCursors = ''
    let lastEnd = 0

    for (const selection of selectedRanges) {
      originalWithCursors +=
        original.slice(lastEnd, selection.start) +
        cursor +
        original.slice(selection.start, selection.end) +
        cursor
      lastEnd = selection.end
    }

    originalWithCursors += original.slice(lastEnd)

    // Diff
    return [cursor, diff(originalWithCursors, formatted)]
  }

  async applyDiff(editor, cursor, edits) {
    const selections = []
    await editor.edit((e) => {
      let offset = 0
      let toRemove = 0

      // Add an extra empty edit so any trailing delete is actually run.
      edits.push([diff.EQUAL, ''])

      for (const [edit, str] of edits) {
        if (edit === diff.DELETE) {
          toRemove += str.length

          // Check if the cursors are in here
          let cursorIndex = -1
          while (true) {
            cursorIndex = str.indexOf(cursor, cursorIndex + 1)
            if (cursorIndex === -1) break

            const lastSelection = selections[selections.length - 1]
            if (!lastSelection || lastSelection[1]) {
              selections[selections.length] = [offset]
            } else {
              lastSelection[1] = offset
            }
            toRemove -= cursor.length
          }

          continue
        }

        if (edit === diff.EQUAL && toRemove) {
          e.replace(new Range(offset, offset + toRemove), '')
        } else if (edit === diff.INSERT) {
          e.replace(new Range(offset, offset + toRemove), str)
        }

        toRemove = 0
        offset += str.length
      }
    })

    editor.selectedRanges = selections.map((s) => new Range(s[0], s[1]))
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
