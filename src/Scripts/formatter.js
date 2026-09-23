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
} = require('./helpers.js')

const { showNotification, cancelNotification } = require('./notifications.js')

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
      // High surrogate: 4 bytes if properly paired, else U+FFFD (3 bytes)
      const next = str.charCodeAt(i + 1)
      if (next >= 0xdc00 && next < 0xe000) {
        bytes += 4
        i++
      } else {
        bytes += 3
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
} = require('./sql.js')

/**
 * Single source of truth for bundled plugins: the config key under
 * `prettier.plugins.*`, the bundled entry point, and — when the plugin
 * has Nova-managed options — the loader producing them.
 *
 * Flag-only plugins (ejs, tailwind) never act as the
 * primary parser for a syntax; they're selected by the ordering rules
 * in formatEditor.
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
    // handled separately — depends on the configured formatter type
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
    /** @type {Set<string>} config-declared plugins already reported as crashed */
    this._disabledPluginsNotified = new Set()
    /** path of the custom config file the last load-failure notice covered */
    this._lastCustomConfigErrorPath = null
    /** true while a planned stop/restart cycle is in progress */
    this._restarting = false
    /** handle for the 5s force-stop timer scheduled in stop() */
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

  get isReady() {
    if (!this._isReadyPromise) {
      // A planned stop/restart cycle (e.g. after a config file change) is
      // in progress — skip the "Prettier Stopped Running" notification and
      // let callers quietly skip formatting until the new service is up.
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
    // If we're currently stopping we'll wait for that to complete before starting
    if (this._isStoppedPromise) {
      await this._isStoppedPromise
    }

    if (this.prettierService) return
    log.info('Starting Prettier service…')

    // Await the didStart handshake so callers (e.g. the retry loop in
    // startFormatter) can detect service-side load failures, not just
    // Process construction errors.
    const handshake = new Promise((resolve, reject) => {
      this._resolveStartHandshake = resolve
      this._rejectStartHandshake = reject
    })
    this._startHandshake = handshake

    const proc = new Process('/usr/bin/env', {
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
    this.prettierService = proc

    // Stale-process guard: a superseded process's late events must never
    // act on the current handshake or service state (e.g. a crashed
    // process's late didStart resolving the replacement's handshake).
    const isCurrent = () => this.prettierService === proc

    proc.onDidExit((exitCode) => {
      if (isCurrent()) this.prettierServiceDidExit(exitCode)
    })
    proc.onNotify('didStart', () => {
      if (!isCurrent()) return
      log.info('Prettier service started successfully')
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
    // process handle *before* terminating: prettierServiceDidExit then
    // bails out at its `!this.prettierService` guard, so it won't run the
    // crash-restart path that would race the caller's retry loop.
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
          // already exited — nothing to terminate
        }
      }

      this._rejectStartHandshake(
        new Error(
          `Prettier service did not signal startup within ${START_TIMEOUT_MS}ms`,
        ),
      )
    }, START_TIMEOUT_MS)

    try {
      await handshake
    } finally {
      clearTimeout(timeout)
      // Only clear our own handshake — a restart triggered by
      // prettierServiceDidExit may have already replaced it.
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

    // Create a promise that we’ll resolve either on exit or on timeout
    this._isStoppedPromise = new Promise((resolve) => {
      // wrap the original resolve so we can log duration
      this._resolveIsStoppedPromise = () => {
        const delta = Date.now() - startTs
        log.debug(`Prettier exited in ${delta}ms`)
        resolve()
      }
    })

    // Signal “not ready” immediately
    if (this._resolveIsReadyPromise) this._resolveIsReadyPromise(false)
    this._isReadyPromise = null

    // Politely ask for termination
    proc.terminate()

    // If it hasn’t exited in 5s, force it
    this._forceStopTimer = setTimeout(() => {
      this._forceStopTimer = null
      // still pending?
      if (this._isStoppedPromise) {
        log.error('Prettier did NOT exit in 5000ms, forcing stop.')
        this._resolveIsStoppedPromise()
      }
    }, 5000)

    // Don’t clear `this.prettierService` here—wait for onDidExit to do it
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
    // 0) Reject any pending start handshake — the process exited before
    //    completing the didStart handshake.
    if (this._startHandshake) {
      this._startHandshake = null
      this._rejectStartHandshake(
        new Error(
          `Prettier service exited before starting (exit code ${exitCode})`,
        ),
      )
    }

    // 1) Wake up anyone awaiting stop()
    if (this._resolveIsStoppedPromise) {
      clearTimeout(this._forceStopTimer)
      this._forceStopTimer = null
      this._resolveIsStoppedPromise()
      this._isStoppedPromise = null
    }

    // 2) If the service object is already gone, bail out
    if (!this.prettierService) return

    log.debug('Prettier service exited with code:', exitCode)

    // 3) Mark “not ready” so calls to isReady will error
    if (this._resolveIsReadyPromise) this._resolveIsReadyPromise(false)
    this._isReadyPromise = null

    // 4) Clear out the old service handle
    this.prettierService = null

    // 5) If exitCode is 0 → clean stop → do nothing further
    if (exitCode === 0) {
      return
    }

    // 6) Non-zero exit → unexpected crash.
    //    If we’ve already crashed recently, show an error instead of restarting forever.
    if (this.prettierServiceCrashedRecently) {
      return this.showServiceNotRunningError()
    }

    // 7) First crash in a short window → mark it and schedule a reset
    this.prettierServiceCrashedRecently = true
    setTimeout(() => (this.prettierServiceCrashedRecently = false), 5000)

    // 8) Now restart the service
    log.debug('Restarting Prettier…')
    this.start().catch(() => {
      // startDidFail already surfaced the reason via notification
    })
  }

  prettierServiceDidCrash({ parameters }) {
    // The service sends this right before exiting after an
    // uncaughtException or unhandledRejection — prettierServiceDidExit
    // handles restart/notification once it's gone. Our job here is
    // surfacing the crash reason, which would otherwise be lost and
    // leave only an opaque IPC rejection behind.
    const { name, message, stack } = parameters ?? {}
    log.error(
      `Prettier service crashed: ${name ?? 'Unknown'}: ${message ?? 'no message'}${stack ? `\n${stack}` : ''}`,
    )
  }

  prettierServiceStartDidFail({ parameters: error }) {
    if (this._resolveIsReadyPromise) this._resolveIsReadyPromise(false)

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
      body: nova.localize(
        'prettier.notification.could-not-load-prettier.body',
        "Please ensure your Node.js installation is up to date. Additionally, check if the 'Prettier module' path is correctly set in your extension or project settings. For more details, refer to the error log in the Extension Console.",
        'notification',
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
      body: nova.localize(
        'prettier.notification.stopped-running.body',
        'If this problem persists, please report the issue through the Extension Library.',
        'notification',
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

    // Skip formatting files larger than 32 MiB to stay within the IPC payload limit.
    // Files up to ~42 MiB have been tested, but anything over 32 MiB isn’t officially
    // supported.
    const MAX_FILE_SIZE = 32 * 1024 * 1024 // 32 MiB
    if (document.length > MAX_FILE_SIZE) {
      this.notifyFileTooLarge(document.length)
      return []
    }

    const syntaxKey = this.getSyntaxKey(editor)
    log.debug(`Resolved Syntax Key: ${syntaxKey}`)

    // If we couldn’t detect a syntax, don’t even try to format
    if (!syntaxKey) {
      log.info(`No syntax detected for ${document.path}; skipping formatting.`)
      return []
    }

    cancelNotification('prettier-unsupported-syntax')

    // Read the custom config file path from settings. A relative path is
    // resolved against the workspace — the same way main.js watches the
    // file — because Nova's fs APIs resolve relative paths against the
    // extension's working directory, not the workspace.
    let customConfigFile = getConfigWithWorkspaceOverride(
      'prettier.config.file',
    )
    if (customConfigFile && !nova.path.isAbsolute(customConfigFile)) {
      if (nova.workspace.path) {
        customConfigFile = nova.path.join(nova.workspace.path, customConfigFile)
      } else {
        // No workspace to anchor the path against — the service would
        // resolve it against its own (extension-dir) cwd. Treat the
        // setting as unset instead of loading a stray file.
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

    // Retrieve the ignore flag and custom config file settings:
    const ignoreConfigFile = getConfigWithWorkspaceOverride(
      'prettier.config.ignore',
    )

    log.debug(`[Forced=${flags.force}] Formatting ${document.path}`)
    log.debug(`Document Syntax: ${syntaxKey}`)
    log.debug(`Document URI: ${document.uri}`)

    const documentRange = new Range(0, document.length)
    const original = editor.getTextInRange(documentRange)

    // The character guard above counts characters, but the JSON-RPC frame
    // cap is bytes — a multibyte document (e.g. CJK at 3 bytes/char) can
    // pass it yet overflow the service's 42 MiB Content-Length limit and
    // kill the parser stream. Check the real UTF-8 payload size too.
    const originalByteLength = utf8ByteLength(original)
    if (originalByteLength > MAX_FILE_SIZE) {
      this.notifyFileTooLarge(originalByteLength)
      return []
    }

    // Check if plugins are enabled
    // Tailwind is driven by both a master flag and a per-syntax flag.
    const tailwindPluginEnabled = isPluginEnabled(
      PLUGIN_DESCRIPTORS.tailwind.configKey,
    )
    const tailwindSyntaxesEnabled = getConfigWithWorkspaceOverride(
      `prettier.plugins.prettier-plugin-tailwind.syntaxes.${syntaxKey}`,
    )

    // 1) Kick off with an empty array
    const plugins = []

    // 2) Conditionally load plugins if enabled
    if (this.modulePath?.includes(nova.extension.path)) {
      const primaryPlugin = PLUGIN_DESCRIPTORS[syntaxKey]

      if (primaryPlugin && isPluginEnabled(primaryPlugin.configKey)) {
        plugins.push(primaryPlugin.pluginPath)
      }

      // For html and html+ejs the EJS plugin rewrites EJS tags into
      // placeholder nodes the html parser understands, so it must be
      // loaded before prettier-plugin-tailwindcss, which must be last.
      // (prettier-plugin-ejs-tailwindcss is no longer used: it crashes
      // on Prettier 3.9's embedded-languages visitor keys and the
      // plain ejs + tailwind composition produces identical output.)
      if (syntaxKey === 'html+ejs' || syntaxKey === 'html') {
        if (isPluginEnabled(PLUGIN_DESCRIPTORS.ejs.configKey)) {
          plugins.push(PLUGIN_DESCRIPTORS.ejs.pluginPath)
        }
      }

      // prettier-plugin-tailwindcss must be loaded last.
      // See: https://github.com/tailwindlabs/prettier-plugin-tailwindcss#compatibility-with-other-prettier-plugins
      if (tailwindSyntaxesEnabled && tailwindPluginEnabled) {
        plugins.push(PLUGIN_DESCRIPTORS.tailwind.pluginPath)
      }
    }

    const options = {
      parser: this.getParserForSyntax(syntaxKey),
      ...(plugins.length > 0 ? { plugins } : {}),
      ...(document.path ? { filepath: document.path } : {}),
      // The custom config file is resolved by the service via Prettier's
      // own config resolution (JSON, YAML, TOML, JS…). Nothing to merge
      // client-side — the service layers it in as the inferred config.
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
      // Pass the flag to the Prettier service so it knows to ignore external config.
      _ignoreConfigFile: ignoreConfigFile,
      _customConfigFile: customConfigFile,
    }

    // Apply plugin options only if no config is found or it’s intentionally ignored.
    if (!customConfigFile && (ignoreConfigFile || shouldApplyDefaultConfig)) {
      // Plugin options for the document's syntax — looked up by syntax key,
      // regardless of the plugin's enabled flag (matching the old behavior).
      const optionsConfig = PLUGIN_DESCRIPTORS[syntaxKey]?.optionsConfig
      if (optionsConfig) {
        Object.assign(options, optionsConfig())
      }

      // TAILWIND plugin options apply to any supported syntax,
      // not just the syntax the plugin itself parses
      if (tailwindSyntaxesEnabled && tailwindPluginEnabled) {
        Object.assign(options, getTailwindConfig())
      }

      // SQL plugin options depend on the configured formatter implementation
      if (syntaxKey === 'sql') {
        const sqlFormatter = getConfigWithWorkspaceOverride(
          'prettier.plugins.prettier-plugin-sql.formatter',
        )

        if (sqlFormatter === 'sql-formatter') {
          const config = { ...getSqlFormatterConfig() }

          if (config.language === 'auto') {
            config.language = getSqlDialectFromUriOrSyntax(
              document.uri,
              document.syntax,
            )
            log.debug(`Auto-detected SQL dialect: ${config.language}`)
          }

          Object.assign(options, config)
        } else if (sqlFormatter === 'node-sql-parser') {
          const config = { ...getNodeSqlParserConfig() }

          if (config.database === 'auto') {
            config.database = getSqlParserDialect(document.uri, document.syntax)
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

    // 1) Ensure the JSON-RPC service is ready
    const ready = await this.isReady
    if (!ready) {
      log.error(
        'Prettier service never started or is not running, skipping format',
      )
      return []
    }

    // Identify this file
    const uri = editor.document.uri.toString()

    // bump and capture this file’s request ID
    const last = this._latestRequestIds.get(uri) || 0
    const requestId = last + 1
    this._latestRequestIds.set(uri, requestId)

    // 2) Fire the format request, catching any IPC failure. Track it as
    //    in-flight so a pending restart can wait for it to settle before
    //    stopping the service.
    const pending = (async () => {
      try {
        return await this.prettierService.request('format', {
          original,
          pathForConfig,
          ignorePath: flags.force ? null : this.getIgnorePath(pathForConfig),
          options: {
            ...options,
            cursorOffset: editor.selectedRange.start, // send cursor position
          },
          withCursor: true, // signal that we want formatWithCursor
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

    // 3) If a newer call for **this same file** started in the meantime, drop
    // This check ensures that stale responses are ignored when multiple format
    // requests are fired concurrently for the same file. It compares the current
    // request ID with the latest request ID stored for the file.
    if (requestId !== this._latestRequestIds.get(uri)) {
      log.debug('Stale Prettier response, ignoring')
      return []
    }

    // 3.1) remove the entry so we don’t leak
    this._latestRequestIds.delete(uri)

    // 4) Destructure Prettier’s response
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

    // The service classifies the plugins declared in the user's config
    // whenever bundled plugins were injected:
    // - loadedPlugins: resolved from the project's node_modules and active
    // - unresolvedPlugins: not bundled and not found in the project — the
    //   bundled equivalents (if any) are used instead
    // - disabledPlugins: crashed while formatting — the service retried
    //   without them
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

    // The service couldn't load the user's custom config file — surface
    // it visibly instead of silently formatting without it. Once the
    // config loads again (e.g. after the user fixes it), the notice is
    // cancelled.
    if (configError) {
      this.showCustomConfigErrorNotice(configError)
    } else {
      cancelNotification('prettier-custom-config-error')
      this._lastCustomConfigErrorPath = null
    }

    // newCursor may be a number or undefined/null. Prettier returns -1 when
    // the cursor cannot be mapped onto the formatted output (e.g. the
    // surrounding text was rewritten), which is not a valid document offset.
    // Keep this in a per-call local: a shared field could be overwritten by a
    // concurrent format for another editor while we await editor.edit below,
    // restoring the wrong cursor.
    let cursorOffset = editor.selectedRange.start
    if (newCursor == null || newCursor < 0) {
      // Prettier really couldn’t compute a position
      log.debug(
        `Prettier returned no cursor (${newCursor ?? 'null/undefined'}); falling back to editor position ${cursorOffset}`,
      )
    } else {
      // A numeric cursor — trust it
      cursorOffset = newCursor
      log.debug('New Cursor Position:', newCursor)
    }

    // 3) Error or missing parser
    if (error) {
      return this._handlePrettierError(
        // The service serializes thrown errors as plain objects over
        // JSON-RPC. Rehydrate a real Error so thrown values render their
        // message in logs and notifications instead of "[object Object]".
        Object.assign(
          new Error(error.message ?? 'Unknown Prettier error'),
          error,
        ),
        missingParser,
        saving,
        document.path,
      )
    }

    // 4) Explicit ignore
    if (ignored) {
      log.debug(`Prettier is configured to ignore ${document.path}`)
      return []
    }

    // 5) No output
    if (!formatted) {
      log.debug(`Prettier returned no formatted output for ${document.path}`)
      return []
    }

    // 6) No changes
    if (formatted === original) {
      log.debug(`No changes for ${document.path}`)
      return []
    }

    // 7) Finally apply
    await this.applyResult(editor, formatted, cursorOffset)
  }

  async shouldApplyDefaultConfig(
    syntaxKey,
    document,
    saving,
    pathForConfig,
    customConfigFile,
  ) {
    // Don't format-on-save ignore syntaxes.
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
    // exists" — skip the hasConfig probe (and its IPC round-trip) so
    // format-on-save.ignore-without-config doesn't skip saves when the
    // project itself has no config file but the user pointed the
    // extension at one.
    let hasConfig = customConfigFile != null

    if (document.isRemote) {
      // Don't format-on-save remote documents if they're ignored.
      if (
        saving &&
        getConfigWithWorkspaceOverride('prettier.format-on-save.ignore-remote')
      ) {
        return null
      }
    } else if (!hasConfig) {
      // Try to resolve configuration using Prettier for non-remote documents.
      // 1) Wait for didStart handshake
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

    // Fall back to the editor’s position when no cursor was threaded in.
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

    // a “real” formatting error
    return this._issuesFromPrettierError(error)
  }

  _issuesFromPrettierError(error) {
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
    issue.line = Number(lineData[1])
    issue.column = Number(lineData[2])

    return [issue]
  }
}

module.exports = {
  Formatter,
}
