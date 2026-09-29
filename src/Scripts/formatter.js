/**
 * formatter.js — Prettier⁺ formatter engine for Nova
 *
 * @license MIT
 * @author Alexander Weiss, Toni Förster
 * @copyright © 2023 Alexander Weiss, © 2025 Toni Förster
 *
 * Provides the core formatting logic and manages communication
 * with the background Prettier service via JSON-RPC.
 */

const {
  getConfigWithWorkspaceOverride,
  isDebugLoggingEnabled,
  log,
  spawnNode,
} = require('./helpers.js')

const {
  showNotification,
  cancelNotification,
  describeFailure,
  withReason,
} = require('./notifications.js')

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
  getShConfig,
  getSqlFormatterConfig,
  getTailwindConfig,
  getTomlConfig,
  getTwigConfig,
  getXmlConfig,
} = require('./prettier-config.js')

const { detectSyntax } = require('./syntax.js')

// Paths already reported this session, keyed by report level — service
// restarts must not re-spam the console, and a mode switch (native →
// bundled) must still escalate the report to a warning.
const warnedMissingPluginPaths = new Set()

/**
 * Bundled plugins whose registry entry file is missing from the
 * installed bundle — usually a plugin update that reshuffled its file
 * layout while prettier-plugins.js still points at the old path.
 *
 * @returns {{ key: string, path: string }[]}
 */
function findMissingBundledPlugins() {
  return Object.entries(pluginPaths)
    .filter(([, pluginPath]) => !nova.fs.stat(pluginPath))
    .map(([key, pluginPath]) => ({ key, path: pluginPath }))
}

/**
 * Count the UTF-8 byte length of a string without relying on Node's
 * Buffer (unavailable in Nova's extension runtime).
 *
 * @param {string} str
 * @returns {number}
 */
function utf8ByteLength(str) {
  let bytes = 0
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i)
    if (code < 0x80) {
      bytes += 1
    } else if (code < 0x800) {
      bytes += 2
    } else if (code >= 0xd800 && code < 0xdc00) {
      const next = str.charCodeAt(i + 1)
      if (next >= 0xdc00 && next < 0xe000) {
        bytes += 4
        i++
      } else {
        bytes += 3 // unpaired → U+FFFD
      }
    } else if (code >= 0xdc00 && code < 0xe000) {
      bytes += 3 // lone low surrogate → U+FFFD
    } else {
      bytes += 3
    }
  }
  return bytes
}

const {
  getSqlDialectFromUriOrSyntax,
  getSqlParserDialect,
  dialectSupportedBy,
  resolveSqlFormatter,
} = require('./sql.js')

/**
 * Single source of truth for bundled plugins: config key under
 * `prettier.plugins.*`, bundled entry point, and — for plugins with
 * Nova-managed options — the loader producing them. Flag-only plugins
 * (ejs, tailwind) never act as the primary parser for a syntax; they
 * are selected by the ordering rules in formatEditor.
 */
const PLUGIN_DESCRIPTORS = {
  astro: {
    configKey: 'prettier-plugin-astro',
    pluginPath: pluginPaths.astro,
    optionsConfig: getAstroConfig,
  },
  blade: {
    configKey: 'prettier-plugin-blade',
    pluginPath: pluginPaths.blade,
    optionsConfig: getBladeConfig,
  },
  ejs: {
    configKey: 'prettier-plugin-ejs',
    pluginPath: pluginPaths.ejs,
    optionsConfig: null,
  },
  java: {
    configKey: 'prettier-plugin-java',
    pluginPath: pluginPaths.java,
    optionsConfig: null,
  },
  'java-properties': {
    configKey: 'prettier-plugin-properties',
    pluginPath: pluginPaths.properties,
    optionsConfig: getPropertiesConfig,
  },
  'liquid-html': {
    configKey: 'prettier-plugin-liquid',
    pluginPath: pluginPaths.liquid,
    optionsConfig: getLiquidConfig,
  },
  'liquid-md': {
    configKey: 'prettier-plugin-liquid',
    pluginPath: pluginPaths.liquid,
    optionsConfig: getLiquidConfig,
  },
  nginx: {
    configKey: 'prettier-plugin-nginx',
    pluginPath: pluginPaths.nginx,
    optionsConfig: getNginxConfig,
  },
  php: {
    configKey: 'prettier-plugin-php',
    pluginPath: pluginPaths.php,
    optionsConfig: getPhpConfig,
  },
  sh: {
    configKey: 'prettier-plugin-sh',
    pluginPath: pluginPaths.sh,
    optionsConfig: getShConfig,
  },
  dockerfile: {
    configKey: 'prettier-plugin-sh',
    pluginPath: pluginPaths.sh,
    optionsConfig: getShConfig,
  },
  sql: {
    configKey: 'prettier-plugin-sql',
    pluginPath: pluginPaths.sql,
    // SQL formatter config is handled separately — depends on the
    // configured formatter type
    optionsConfig: null,
  },
  tailwind: {
    configKey: 'prettier-plugin-tailwind',
    pluginPath: pluginPaths.tailwind,
    optionsConfig: getTailwindConfig,
  },
  toml: {
    configKey: 'prettier-plugin-toml',
    pluginPath: pluginPaths.toml,
    optionsConfig: getTomlConfig,
  },
  twig: {
    configKey: 'prettier-plugin-twig',
    pluginPath: pluginPaths.twig,
    optionsConfig: getTwigConfig,
  },
  xml: {
    configKey: 'prettier-plugin-xml',
    pluginPath: pluginPaths.xml,
    optionsConfig: getXmlConfig,
  },
}

/**
 * Read a plugin's enabled flag from workspace-or-extension config.
 *
 * @param {string} configKey  the plugin's key under `prettier.plugins.*`
 * @returns {boolean|undefined}
 */
function isPluginEnabled(configKey) {
  return getConfigWithWorkspaceOverride(`prettier.plugins.${configKey}.enabled`)
}

class Formatter {
  constructor() {
    this.prettierServiceDidExit = this.prettierServiceDidExit.bind(this)
    this.prettierServiceStartDidFail =
      this.prettierServiceStartDidFail.bind(this)
    this.prettierServiceDidCrash = this.prettierServiceDidCrash.bind(this)

    this.emitter = new Emitter()
    /** @type {Map<string,number>} latest in-flight request IDs per file URI */
    this._latestRequestIds = new Map()
    /** @type {Set<Promise>} format requests currently in flight */
    this._pendingFormats = new Set()
    /** config-declared plugins already reported as crashed */
    this._disabledPluginsNotified = new Set()
    /** custom config path covered by the last load-failure notice */
    this._lastCustomConfigErrorPath = null
    /** true while a planned stop/restart cycle is in progress */
    this._restarting = false
    /** most recent failure since the service last started, for notifications */
    this._lastFailure = null
    /** whether _lastFailure is a specific reason (crash/timeout/start fail) —
        generic exit-code reasons may be refreshed by newer failures */
    this._lastFailureIsSpecific = false
    /** external plugins seen in the most recent format, for Prettier Info */
    this._lastLoadedPlugins = []
    this._lastUnresolvedPlugins = []
    this._lastDisabledPlugins = []
    /** 5s force-stop timer from stop() */
    this._forceStopTimer = null

    this.setupIsReadyPromise()
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

  /**
   * Cheap synchronous check whether the service process is alive.
   * prettierService is nulled on exit, crash and stop, so this never
   * reports a dead process as running.
   *
   * @returns {boolean}
   */
  isRunning() {
    return !!this.prettierService
  }

  get isReady() {
    if (!this._isReadyPromise) {
      // A planned stop/restart cycle (e.g. after a config file change) is
      // in progress — skip the "Prettier Stopped Running" notification
      // and let callers quietly skip formatting until the service is up.
      if (!this._restarting) this.showServiceNotRunningError()
      return false
    }

    return this._isReadyPromise
  }

  async start(modulePath) {
    if (modulePath) this.modulePath = modulePath

    if (!this.modulePath) {
      throw new Error('Prettier module path is required to start the service')
    }

    if (!this._isReadyPromise) this.setupIsReadyPromise()
    if (this._isStoppedPromise) {
      // wait for a pending stop before starting
      await this._isStoppedPromise
    }

    if (this.prettierService) return
    log.info('Starting Prettier service…')

    // Bundled plugins only load when the bundled Prettier module runs
    // (see the options.plugins gate in the format request) — a missing
    // entry file there fails its syntaxes at format time with no visible
    // cause, so surface it here. In native modes the files are never
    // imported, so stay quiet at debug level.
    const bundledMode = this.modulePath?.includes(nova.extension.path)
    for (const { key, path } of findMissingBundledPlugins()) {
      const dedupeKey = `${bundledMode ? 'warn' : 'debug'}:${path}`
      if (warnedMissingPluginPaths.has(dedupeKey)) continue
      warnedMissingPluginPaths.add(dedupeKey)
      if (bundledMode) {
        log.warn(
          `Bundled plugin "${key}" is missing its entry file — check prettier-plugins.js against the installed package: ${path}`,
        )
      } else {
        log.debug(
          `Bundled plugin "${key}" is not installed (bundled modules not populated): ${path}`,
        )
      }
    }

    // Await the didStart handshake so callers can detect service-side
    // load failures, not just Process construction errors.
    const handshake = new Promise((resolve, reject) => {
      this._resolveStartHandshake = resolve
      this._rejectStartHandshake = reject
    })
    this._startHandshake = handshake

    let proc
    try {
      proc = await spawnNode(
        [
          nova.path.join(
            nova.extension.path,
            'Scripts',
            'prettier-service',
            'prettier-service.js',
          ),
          this.modulePath,
        ],
        { stdio: 'jsonrpc', cwd: nova.workspace.path },
      )
    } catch (err) {
      // No Node.js runtime is available — settle the handshake so it
      // doesn't dangle, then surface the failure to the retry loop.
      this._startHandshake = null
      this._rejectStartHandshake(err)
      throw err
    }

    this.prettierService = proc

    // Stale-process guard: a superseded process's late events must never
    // act on the current handshake or service state.
    const isCurrent = () => this.prettierService === proc

    proc.onDidExit((exitCode) => {
      if (isCurrent()) this.prettierServiceDidExit(exitCode)
    })
    proc.onNotify('didStart', () => {
      if (!isCurrent()) return
      log.info('Prettier service started successfully')
      this._lastFailure = null
      this._lastFailureIsSpecific = false
      if (this._resolveIsReadyPromise) this._resolveIsReadyPromise(true)
      this._resolveStartHandshake()
    })
    proc.onNotify('startDidFail', (error) => {
      if (isCurrent()) this.prettierServiceStartDidFail(error)
    })
    proc.onNotify('didCrash', (params) => {
      if (isCurrent()) this.prettierServiceDidCrash(params)
    })
    proc.start()

    // If the service neither signals didStart nor exits, tear it down so
    // start() rejects and a retry begins from a clean slate. Detach the
    // process handle *before* terminating so prettierServiceDidExit bails
    // at its !this.prettierService guard instead of racing the retry
    // loop with a crash-restart.
    const START_TIMEOUT_MS = 10000
    const timeout = setTimeout(() => {
      if (this._startHandshake !== handshake) return // already settled
      this._startHandshake = null

      const hungProcess = this.prettierService
      this.prettierService = null
      if (this._resolveIsReadyPromise) this._resolveIsReadyPromise(false)
      this._isReadyPromise = null
      if (hungProcess) {
        try {
          hungProcess.terminate()
        } catch {
          // already exited
        }
      }

      this._lastFailure = new Error(
        `Prettier service did not signal startup within ${START_TIMEOUT_MS}ms`,
      )
      this._lastFailureIsSpecific = true
      this._rejectStartHandshake(this._lastFailure)
    }, START_TIMEOUT_MS)

    try {
      await handshake
    } finally {
      clearTimeout(timeout)
      // Only clear our own handshake — a crash-triggered restart may
      // have replaced it.
      if (this._startHandshake === handshake) this._startHandshake = null
    }
  }

  stop() {
    cancelNotification('prettier-not-running')
    if (!this._isReadyPromise || !this.prettierService) return
    if (this._isStoppedPromise) return

    const startTs = Date.now()
    const proc = this.prettierService

    log.info('Stopping Prettier service…')

    this._isStoppedPromise = new Promise((resolve) => {
      // wrap resolve so stop duration is logged
      this._resolveIsStoppedPromise = () => {
        const delta = Date.now() - startTs
        log.debug(`Prettier exited in ${delta}ms`)
        resolve()
      }
    })

    if (this._resolveIsReadyPromise) this._resolveIsReadyPromise(false)
    this._isReadyPromise = null

    proc.terminate()

    // force stop if it hasn't exited in 5s
    this._forceStopTimer = setTimeout(() => {
      this._forceStopTimer = null
      if (this._isStoppedPromise) {
        log.error('Prettier did NOT exit in 5000ms, forcing stop.')
        this._resolveIsStoppedPromise()
      }
    }, 5000)

    // keep this.prettierService — onDidExit clears it
    return this._isStoppedPromise
  }

  setupIsReadyPromise() {
    this._isReadyPromise = new Promise((resolve) => {
      this._resolveIsReadyPromise = resolve
    })
  }

  /**
   * Waits until all in-flight format requests have settled (or the given
   * timeout elapses). Used before a planned restart so a save-triggered
   * format isn't cut short by stopping the service mid-request.
   * @param {number} [timeoutMs] safety timeout so a hung RPC can't block
   *                             the restart forever
   */
  async waitForPendingFormats(timeoutMs = 10000) {
    if (this._pendingFormats.size === 0) return

    await Promise.race([
      Promise.allSettled([...this._pendingFormats]),
      new Promise((resolve) => setTimeout(resolve, timeoutMs)),
    ])
  }

  prettierServiceDidExit(exitCode) {
    // Reject pending start handshakes — the process exited before
    // completing the didStart handshake.
    if (this._startHandshake) {
      this._startHandshake = null
      this._rejectStartHandshake(
        new Error(
          `Prettier service exited before starting (exit code ${exitCode})`,
        ),
      )
    }

    // Wake anyone awaiting stop()
    if (this._resolveIsStoppedPromise) {
      clearTimeout(this._forceStopTimer)
      this._forceStopTimer = null
      this._resolveIsStoppedPromise()
      this._isStoppedPromise = null
    }

    // Service handle already gone — nothing to do
    if (!this.prettierService) return

    log.debug('Prettier service exited with code:', exitCode)

    // Mark "not ready" so isReady will report failure
    if (this._resolveIsReadyPromise) this._resolveIsReadyPromise(false)
    this._isReadyPromise = null

    this.prettierService = null

    // Clean stop — nothing further
    if (exitCode === 0) return

    // Unexpected crash. Keep a more specific reason (didCrash/startDidFail)
    // if already recorded; refresh stale generic exit-code reasons.
    if (!this._lastFailure || !this._lastFailureIsSpecific) {
      this._lastFailure = new Error(
        `Prettier service exited unexpectedly (exit code ${exitCode})`,
      )
      this._lastFailureIsSpecific = false
    }

    // Already crashed recently — show an error instead of restarting forever
    if (this.prettierServiceCrashedRecently) {
      return this.showServiceNotRunningError()
    }

    this.prettierServiceCrashedRecently = true
    setTimeout(() => (this.prettierServiceCrashedRecently = false), 5000)

    log.debug('Restarting Prettier…')
    this.start().catch(() => {
      // startDidFail already surfaced the reason via notification
    })
  }

  prettierServiceDidCrash({ parameters }) {
    // Sent right before exit after an uncaughtException/unhandledRejection
    // — prettierServiceDidExit restarts and notifies. Without this the
    // crash reason is lost, leaving only an opaque IPC rejection.
    const { name, message, stack } = parameters ?? {}
    this._lastFailure = new Error(
      `${name ?? 'Error'}: ${message ?? 'no message'}`,
    )
    this._lastFailureIsSpecific = true
    log.error(
      `Prettier service crashed: ${name ?? 'Unknown'}: ${message ?? 'no message'}${stack ? `\n${stack}` : ''}`,
    )
  }

  prettierServiceStartDidFail({ parameters: error }) {
    if (this._resolveIsReadyPromise) this._resolveIsReadyPromise(false)
    this._lastFailure = new Error(`${error.name}: ${error.message}`)
    this._lastFailureIsSpecific = true

    // Wake the awaiting start() caller with the actual failure reason.
    if (this._startHandshake) {
      this._startHandshake = null
      this._rejectStartHandshake(new Error(`${error.name}: ${error.message}`))
    }

    showNotification({
      id: 'prettier-not-running',
      title: nova.localize(
        'prettier.notification.could-not-load-prettier.title',
        'Can’t Load Prettier',
        'notification',
      ),
      body: withReason(
        nova.localize(
          'prettier.notification.could-not-load-prettier.body',
          "Please ensure your Node.js installation is up to date. Additionally, check if the 'Prettier module' path is correctly set in your extension or project settings. For more details, refer to the error log in the Extension Console.",
          'notification',
        ),
        describeFailure(this._lastFailure),
      ),
      actions: [
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
      callback: (r) => {
        if (r === 0) nova.workspace.openConfig()
        else nova.openConfig()
      },
    })

    log.error(`${error.name}: ${error.message}\n${error.stack}`)
  }

  showServiceNotRunningError() {
    showNotification({
      id: 'prettier-not-running',
      title: nova.localize(
        'prettier.notification.stopped-running.title',
        'Prettier Stopped Running',
        'notification',
      ),
      body: withReason(
        nova.localize(
          'prettier.notification.stopped-running.body',
          'If this problem persists, please report the issue through the Extension Library.',
          'notification',
        ),
        describeFailure(this._lastFailure),
      ),
      actions: [
        nova.localize(
          'prettier.notification.stopped-running.action.restart',
          'Restart Prettier',
          'notification',
        ),
      ],
      callback: (r) => {
        if (r === 0) this.start().catch(() => {})
      },
    })
  }

  async formatEditorForced(editor) {
    return this.formatEditor(editor, false, false, { force: true })
  }

  /**
   * Format this editor’s text via JSON-RPC.
   * @param {Editor} editor
   * @param {boolean} saving
   * @param {boolean} selectionOnly
   * @param {object} flags
   * @returns {Promise<Array<Issue>>} – list of formatting issues or []
   * @throws {never} All errors are caught and returned as [] or via showNotification
   */
  async formatEditor(editor, saving, selectionOnly, flags = {}) {
    const { document } = editor

    // Skip files larger than 32 MiB — stays within the IPC payload limit.
    const MAX_FILE_SIZE = 32 * 1024 * 1024 // 32 MiB
    if (document.length > MAX_FILE_SIZE) {
      this.notifyFileTooLarge(document.length)
      return []
    }

    const syntaxKey = this.getSyntaxKey(editor)
    log.debug(`Resolved Syntax Key: ${syntaxKey}`)

    if (!syntaxKey) {
      log.info(`No syntax detected for ${document.path}; skipping formatting.`)
      return []
    }

    cancelNotification('prettier-unsupported-syntax')

    // Read the custom config path from settings; relative paths resolve
    // against the workspace (matching main.js's watcher) since Nova fs
    // APIs resolve them against the extension's working directory.
    let customConfigFile = getConfigWithWorkspaceOverride(
      'prettier.config.file',
    )
    if (customConfigFile && !nova.path.isAbsolute(customConfigFile)) {
      if (nova.workspace.path) {
        customConfigFile = nova.path.join(nova.workspace.path, customConfigFile)
      } else {
        // No workspace to anchor the path against — the service would
        // resolve it against its own extension-dir cwd. Treat as unset.
        log.warning(
          `prettier.config.file is relative but no workspace is open — ignoring "${customConfigFile}"`,
        )
        customConfigFile = null
      }
    }

    const pathForConfig = document.path || nova.workspace.path
    const shouldApplyDefaultConfig = await this.shouldApplyDefaultConfig(
      syntaxKey,
      document,
      saving,
      pathForConfig,
      customConfigFile,
    )
    if (shouldApplyDefaultConfig === null && !flags.force) return []

    const ignoreConfigFile = getConfigWithWorkspaceOverride(
      'prettier.config.ignore',
    )

    log.debug(`[Forced=${flags.force}] Formatting ${document.path}`)
    log.debug(`Document Syntax: ${syntaxKey}`)
    log.debug(`Document URI: ${document.uri}`)

    const documentRange = new Range(0, document.length)
    const original = editor.getTextInRange(documentRange)

    // The character guard counts chars, but the JSON-RPC frame cap is
    // bytes — a multibyte document (CJK at 3 bytes/char) can pass it yet
    // overflow the service's 42 MiB Content-Length limit. Check the real
    // UTF-8 payload size too.
    const originalByteLength = utf8ByteLength(original)
    if (originalByteLength > MAX_FILE_SIZE) {
      this.notifyFileTooLarge(originalByteLength)
      return []
    }

    // Check if plugins are enabled — Tailwind is driven by both a master
    // flag and a per-syntax flag.
    const tailwindPluginEnabled = isPluginEnabled(
      PLUGIN_DESCRIPTORS.tailwind.configKey,
    )
    const tailwindSyntaxesEnabled = getConfigWithWorkspaceOverride(
      `prettier.plugins.prettier-plugin-tailwind.syntaxes.${syntaxKey}`,
    )

    const plugins = []

    if (this.modulePath?.includes(nova.extension.path)) {
      const primaryPlugin = PLUGIN_DESCRIPTORS[syntaxKey]

      if (primaryPlugin && isPluginEnabled(primaryPlugin.configKey)) {
        plugins.push(primaryPlugin.pluginPath)
      }

      // For html/html+ejs the EJS plugin must load before tailwind
      // (which must be last). The old ejs+tailwind combo plugin is gone:
      // it crashes on Prettier 3.9's embedded-languages visitor keys and
      // plain ejs + tailwind produces identical output.
      if (syntaxKey === 'html+ejs' || syntaxKey === 'html') {
        if (isPluginEnabled(PLUGIN_DESCRIPTORS.ejs.configKey)) {
          plugins.push(PLUGIN_DESCRIPTORS.ejs.pluginPath)
        }
      }

      // tailwind must be loaded last
      // https://github.com/tailwindlabs/prettier-plugin-tailwindcss#compatibility-with-other-prettier-plugins
      if (tailwindSyntaxesEnabled && tailwindPluginEnabled) {
        plugins.push(PLUGIN_DESCRIPTORS.tailwind.pluginPath)
      }
    }

    const options = {
      parser: this.getParserForSyntax(syntaxKey),
      ...(plugins.length > 0 ? { plugins } : {}),
      ...(document.path ? { filepath: document.path } : {}),
      // The custom config file is resolved by the service via Prettier's
      // own config resolution — nothing to merge client-side.
      ...(customConfigFile
        ? {}
        : ignoreConfigFile || shouldApplyDefaultConfig
          ? getDefaultConfig()
          : {}),
      ...(selectionOnly
        ? {
            rangeStart: editor.selectedRange.start,
            rangeEnd: editor.selectedRange.end,
          }
        : {}),
      // the service reads these to decide how to resolve external config
      _ignoreConfigFile: ignoreConfigFile,
      _customConfigFile: customConfigFile,
    }

    // Plugin options apply only if no config is found or it's ignored.
    if (!customConfigFile && (ignoreConfigFile || shouldApplyDefaultConfig)) {
      // Options for the document's syntax — looked up by syntax key
      // regardless of the plugin's enabled flag (previous behavior).
      const optionsConfig = PLUGIN_DESCRIPTORS[syntaxKey]?.optionsConfig
      if (optionsConfig) {
        Object.assign(options, optionsConfig())
      }

      // Tailwind options apply to any supported syntax, not just the
      // syntax the plugin itself parses
      if (tailwindSyntaxesEnabled && tailwindPluginEnabled) {
        Object.assign(options, getTailwindConfig())
      }

      // SQL plugin options depend on the configured formatter
      if (syntaxKey === 'sql') {
        let sqlFormatter = getConfigWithWorkspaceOverride(
          'prettier.plugins.prettier-plugin-sql.formatter',
        )
        let autoDialect = null

        // Anything not explicitly pinned ('auto', unset, unknown) routes
        // by dialect: sql-formatter preferred, node-sql-parser fallback.
        if (
          sqlFormatter !== 'sql-formatter' &&
          sqlFormatter !== 'node-sql-parser'
        ) {
          autoDialect = getSqlDialectFromUriOrSyntax(
            document.uri,
            document.syntax,
          )
          sqlFormatter = resolveSqlFormatter(autoDialect)

          if (!sqlFormatter) {
            log.info(
              `SQL dialect "${autoDialect}" is not supported by any SQL formatter — formatting skipped`,
            )
            return []
          }

          log.debug(
            `Auto-detected SQL dialect: ${autoDialect} → ${sqlFormatter}`,
          )
        }

        if (sqlFormatter === 'sql-formatter') {
          const config = { ...getSqlFormatterConfig() }

          if (config.language === 'auto') {
            const dialect =
              autoDialect ??
              getSqlDialectFromUriOrSyntax(document.uri, document.syntax)

            if (!dialectSupportedBy('sql-formatter', dialect)) {
              return this.notifySqlDialectMismatch(dialect, 'sql-formatter')
            }

            config.language = dialect
            log.debug(`Auto-detected SQL dialect: ${dialect}`)
          }

          Object.assign(options, config)
        } else if (sqlFormatter === 'node-sql-parser') {
          const config = { ...getNodeSqlParserConfig() }

          if (config.database === 'auto') {
            config.database = getSqlParserDialect(document.uri, document.syntax)

            if (config.database === null) {
              return this.notifySqlDialectMismatch(
                getSqlDialectFromUriOrSyntax(document.uri, document.syntax),
                'node-sql-parser',
              )
            }

            log.debug(`Using node-sql-parser dialect: ${config.database}`)
          }

          Object.assign(options, config)
        }
      }
    }

    // Log the options being used
    if (isDebugLoggingEnabled()) {
      log.debug('Prettier options:', JSON.stringify(options, null, 2))
    }

    const ready = await this.isReady
    if (!ready) {
      log.error(
        'Prettier service never started or is not running, skipping format',
      )
      return []
    }

    const uri = editor.document.uri.toString()

    const last = this._latestRequestIds.get(uri) || 0
    const requestId = last + 1
    this._latestRequestIds.set(uri, requestId)

    // Track as in-flight so a pending restart can wait for it to
    // settle before stopping the service.
    const pending = (async () => {
      try {
        return await this.prettierService.request('format', {
          original,
          pathForConfig,
          ignorePath: flags.force ? null : this.getIgnorePath(pathForConfig),
          options: {
            ...options,
            cursorOffset: editor.selectedRange.start,
          },
          withCursor: true,
        })
      } catch (err) {
        log.error(
          `Prettier IPC error in format: ${err.name}: ${err.message}\n${err.stack}`,
        )
        return null
      }
    })()
    this._pendingFormats.add(pending)
    const result = await pending.finally(() =>
      this._pendingFormats.delete(pending),
    )

    if (result === null) return []

    // Drop stale responses — a newer request for this same file may
    // have fired while this one was in flight.
    if (requestId !== this._latestRequestIds.get(uri)) {
      log.debug('Stale Prettier response, ignoring')
      return []
    }

    this._latestRequestIds.delete(uri)

    const {
      formatted,
      error,
      ignored,
      missingParser,
      cursorOffset: newCursor,
      loadedPlugins,
      unresolvedPlugins,
      disabledPlugins,
      configFile,
      configError,
    } = result

    // Plugin classification from the service (when bundled plugins were
    // injected): loaded = resolved from the project and active,
    // unresolved = bundled equivalents used, disabled = crashed
    // mid-format. Latest classification kept for the Prettier Info
    // command.
    this._lastLoadedPlugins = loadedPlugins ?? []
    this._lastUnresolvedPlugins = unresolvedPlugins ?? []
    this._lastDisabledPlugins = disabledPlugins ?? []

    if (loadedPlugins?.length) {
      log.info(
        `Loaded Prettier plugins from your project: ${loadedPlugins.join(', ')}`,
      )
    }

    if (unresolvedPlugins?.length) {
      log.info(
        `Unresolved Prettier config plugins: ${unresolvedPlugins.join(', ')}`,
      )
      this.showConfigPluginsNotice(unresolvedPlugins, configFile)
    }

    if (disabledPlugins?.length) {
      this.showDisabledPluginsNotice(disabledPlugins)
    }

    // The service couldn't load the user's custom config file — show it
    // instead of silently formatting without it. Cancelled once the
    // config loads again.
    if (configError) {
      this.showCustomConfigErrorNotice(configError)
    } else {
      cancelNotification('prettier-custom-config-error')
      this._lastCustomConfigErrorPath = null
    }

    // Prettier returns -1 when the cursor can't be mapped onto the
    // formatted output (surrounding text rewritten) — not a valid offset.
    // Per-call local: a shared field could be overwritten by a concurrent
    // format for another editor while we await editor.edit.
    let cursorOffset = editor.selectedRange.start
    if (newCursor == null || newCursor < 0) {
      log.debug(
        `Prettier returned no cursor (${newCursor ?? 'null/undefined'}); falling back to editor position ${cursorOffset}`,
      )
    } else {
      cursorOffset = newCursor
      log.debug('New Cursor Position:', newCursor)
    }

    if (error) {
      return this._handlePrettierError(
        // The service serializes thrown errors as plain objects over
        // JSON-RPC — rehydrate a real Error so message shows in logs.
        Object.assign(
          new Error(error.message ?? 'Unknown Prettier error'),
          error,
        ),
        missingParser,
        saving,
        document.path,
      )
    }

    if (ignored) {
      log.debug(`Prettier is configured to ignore ${document.path}`)
      return []
    }

    if (!formatted) {
      log.debug(`Prettier returned no formatted output for ${document.path}`)
      return []
    }

    if (formatted === original) {
      log.debug(`No changes for ${document.path}`)
      return []
    }

    await this.applyResult(editor, formatted, cursorOffset)
  }

  async shouldApplyDefaultConfig(
    syntaxKey,
    document,
    saving,
    pathForConfig,
    customConfigFile,
  ) {
    if (
      saving &&
      getConfigWithWorkspaceOverride(
        `prettier.format-on-save.ignored-syntaxes.${syntaxKey}`,
      ) === true
    ) {
      log.info(`Not formatting (${syntaxKey} syntax ignored) ${document.path}`)
      return null
    }

    // An explicitly configured custom config file counts as "config
    // exists" — skip the hasConfig probe so ignore-without-config doesn't
    // skip saves when the project has no config but the user pointed the
    // extension at one.
    let hasConfig = customConfigFile != null

    if (document.isRemote) {
      if (
        saving &&
        getConfigWithWorkspaceOverride('prettier.format-on-save.ignore-remote')
      ) {
        return null
      }
    } else if (!hasConfig) {
      // Ask the service whether Prettier resolves a config file here
      const ready = await this.isReady
      if (ready) {
        try {
          hasConfig = await this.prettierService.request('hasConfig', {
            pathForConfig,
          })
        } catch (err) {
          log.error(
            `Prettier IPC error in hasConfig: ${err.name}: ${err.message}\n${err.stack}`,
          )
          hasConfig = false
        }
      } else {
        log.error('Prettier service never started, assuming no config')
        hasConfig = false
      }

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

  /**
   * One-time-per-session notice that the user's own config file declares
   * plugins which Prettier⁺ doesn't bundle and couldn't find in the
   * project — formatting continues with the bundled equivalents.
   */
  showConfigPluginsNotice(unresolvedPlugins, configFile) {
    if (this._configPluginsNoticeShown) return
    this._configPluginsNoticeShown = true

    const body =
      nova.localize(
        'prettier.notification.config-plugins.body',
        'Your Prettier config file declares plugins that Prettier⁺ doesn’t bundle and couldn’t find in your project. Formatting continues with the bundled equivalents.',
        'notification',
      ) +
      `\n\n${unresolvedPlugins.join('\n')}` +
      (configFile
        ? `\n\n${nova.localize(
            'prettier.notification.config-plugins.file',
            'Declared in:',
            'notification',
          )} ${configFile}`
        : '')

    showNotification({
      id: 'prettier-config-plugins',
      title: nova.localize(
        'prettier.notification.config-plugins.title',
        'Some Config Plugins Not Loaded',
        'notification',
      ),
      body,
    })
  }

  /**
   * Notice that the user's custom config file (prettier.config.file)
   * couldn't be read or parsed by the service — formatting continues
   * without it. Shown once per failing path; cancelled when the config
   * loads successfully again.
   *
   * @param {{ path: string, message: string }} configError – from the service
   */
  showCustomConfigErrorNotice(configError) {
    log.error(
      `Error loading custom config file at "${configError.path}": ${configError.message}`,
    )

    if (this._lastCustomConfigErrorPath === configError.path) return
    this._lastCustomConfigErrorPath = configError.path

    showNotification({
      id: 'prettier-custom-config-error',
      title: nova.localize(
        'prettier.notification.custom-config-error.title',
        'Custom Config File Failed to Load',
        'notification',
      ),
      body:
        nova.localize(
          'prettier.notification.custom-config-error.body',
          'Formatting continues without the custom Prettier config file. Fix the file or clear the setting, then format again.',
          'notification',
        ) + `\n\n${configError.path}\n${configError.message}`,
    })
  }

  /**
   * One-time-per-plugin notice that a project plugin crashed while
   * formatting — the service retried without it.
   *
   * @param {string[]} disabledPlugins – declared specifiers of the plugins
   */
  showDisabledPluginsNotice(disabledPlugins) {
    const pending = disabledPlugins.filter(
      (name) => !this._disabledPluginsNotified.has(name),
    )
    if (pending.length === 0) return

    for (const name of pending) this._disabledPluginsNotified.add(name)

    log.error(
      `Formatting without project plugin(s) after a load failure: ${pending.join(', ')}`,
    )

    showNotification({
      id: 'prettier-disabled-plugins',
      title: nova.localize(
        'prettier.notification.disabled-plugins.title',
        'Plugins Disabled For This Format',
        'notification',
      ),
      body:
        nova.localize(
          'prettier.notification.disabled-plugins.body',
          'Prettier⁺ couldn’t load the following plugins from your project — possibly because they’re incompatible with the bundled Prettier version — and formatted without them:',
          'notification',
        ) + `\n\n${pending.join('\n')}`,
    })
  }

  /**
   * Show the "Document Too Large" notification for the given size estimate.
   *
   * Callers pass either a UTF-16 char count (early document.length check,
   * before the text is read) or a UTF-8 byte count (after reading). Both
   * are compared against the 32 MiB limit and rendered as "MiB"; the char
   * variant is an approximation that avoids materializing huge text.
   *
   * @param {number} size  size estimate in chars or bytes
   */
  notifyFileTooLarge(size) {
    showNotification({
      id: 'prettier-file-too-large',
      title: nova.localize(
        'prettier.notification.fileTooLarge.title',
        'Document Too Large',
        'notification',
      ),
      body: [
        nova.localize(
          'prettier.notification.fileTooLarge.body.prefix',
          'Cannot format this document:',
          'notification',
        ),
        ` ${(size / 2 ** 20).toFixed(1)} MiB `,
        nova.localize(
          'prettier.notification.fileTooLarge.body.suffix',
          'exceeds the 32 MiB limit.',
          'notification',
        ),
      ].join(''),
    })
  }

  /**
   * Auto-detected SQL dialect isn't supported by the selected formatter
   * implementation. Skips formatting and points the user at the other
   * formatter, which does support the dialect, or at the Auto-Detect
   * setting, which picks a supporting formatter on its own.
   *
   * The notification also fires for save-triggered runs: unlike the
   * unsupported-syntax pattern, this is a config-level problem and the
   * skip would otherwise be invisible. The shared notification id makes
   * repeated attempts replace each other instead of stacking up.
   *
   * @param {string} dialect  The detected SQL dialect (e.g. 'flinksql')
   * @param {'sql-formatter'|'node-sql-parser'} selected  The configured formatter
   * @returns {Array} Empty edit description — formatting was skipped
   */
  notifySqlDialectMismatch(dialect, selected) {
    const other =
      selected === 'sql-formatter' ? 'node-sql-parser' : 'sql-formatter'

    log.info(
      `SQL dialect "${dialect}" is not supported by ${selected} — formatting skipped`,
    )

    showNotification({
      id: 'prettier-sql-dialect-mismatch',
      title: nova.localize(
        'prettier.notification.sqlDialectMismatch.title',
        'Unsupported SQL Dialect',
        'notification',
      ),
      body: [
        nova.localize(
          'prettier.notification.sqlDialectMismatch.body.prefix',
          'The ',
          'notification',
        ),
        `“${dialect}”`,
        nova.localize(
          'prettier.notification.sqlDialectMismatch.body.middle',
          ' dialect isn’t supported by the selected SQL formatter. Switch the SQL formatter to ',
          'notification',
        ),
        `“${other}”`,
        nova.localize(
          'prettier.notification.sqlDialectMismatch.body.suffix',
          ' in the extension settings, or set it to Auto-Detect to pick the formatter that supports this dialect.',
          'notification',
        ),
      ].join(''),
    })
    return []
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

  async applyResult(editor, formatted, cursorOffset) {
    log.info(`Applying formatted changes to ${editor.document.path}`)

    // Restoring a single cursor would destroy multi-cursor setups and
    // active text selections — leave those untouched after the edit.
    const selectedRanges = editor.selectedRanges
    const hasComplexSelection =
      selectedRanges.length > 1 ||
      selectedRanges.some((range) => range.start !== range.end)

    const documentRange = new Range(0, editor.document.length)

    await editor.edit((e) => {
      e.replace(documentRange, formatted)
    })

    if (hasComplexSelection) return

    const offset =
      cursorOffset != null ? cursorOffset : editor.selectedRange.end

    editor.selectedRanges = [new Range(offset, offset)]
    editor.scrollToPosition(offset)
  }

  _handlePrettierError(error, missingParser, saving, filePath) {
    const isParserError = error.message.includes("Couldn't resolve parser")

    if (isParserError || missingParser) {
      if (!saving) {
        showNotification({
          id: 'prettier-unsupported-syntax',
          title: nova.localize(
            'prettier.notification.unsupportedSyntax.title',
            'Unsupported Syntax',
            'notification',
          ),
          body: nova.localize(
            'prettier.notification.missingParser.body',
            'Prettier can’t format this file — no parser is available for its type.',
            'notification',
          ),
        })
      }
      log.info(`No parser for ${filePath}`)
      return []
    }

    return this._issuesFromPrettierError(error)
  }

  _issuesFromPrettierError(error) {
    if (typeof error.message !== 'string') return []

    if (error.name === 'UndefinedParserError') throw error

    // "line:column" form
    let lineData = error.message.match(/\((\d+):(\d+)\)\n/m)
    // "> N | code" form (code frame); column read from the caret line
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
    if (error.stack) {
      issue.message = error.message
    } else {
      // a bare message may have the stack appended — strip it
      issue.message = error.message.split(/\n\s*?at\s+/i)[0]
    }
    issue.severity = IssueSeverity.Error
    issue.line = Number(lineData[1])
    issue.column = Number(lineData[2])

    return [issue]
  }
}

module.exports = {
  Formatter,
  findMissingBundledPlugins,
}
