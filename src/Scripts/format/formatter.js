/**
 * formatter.js — Prettier⁺ formatter engine for Nova
 *
 * @license MIT
 * @author Alexander Weiss, Toni Förster
 * @copyright © 2023 Alexander Weiss, © 2025 Toni Förster
 *
 * Provides the core formatting logic and manages communication
 * with the background Prettier service via JSON-RPC.
 *
 * Owns all service lifecycle state (running path, readiness, failure
 * record) and the per-instance format bookkeeping. Request composition
 * lives in format-request.js, bundled-plugin knowledge in
 * plugin-registry.js, user-facing feedback in format-feedback.js.
 */

const {
  getConfigWithWorkspaceOverride,
  isDebugLoggingEnabled,
  log,
} = require('../helpers.js')

const { spawnNode } = require('../env/runtime.js')

const { rehydrateError } = require('../env/processes.js')

const {
  showNotification,
  cancelNotification,
  describeFailure,
  withReason,
} = require('../notifications.js')

const { reportMissingBundledPlugins } = require('./plugin-registry.js')

const { composeFormatRequest } = require('./format-request.js')

const {
  clearCustomConfigErrorNotice,
  notifyFileTooLarge,
  notifyResultTooLarge,
  notifySqlDialectMismatch,
  prettierErrorToIssues,
  showConfigPluginsNotice,
  showCustomConfigErrorNotice,
  showDisabledPluginsNotice,
} = require('./format-feedback.js')

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

/**
 * Largest serialized format-request body the service accepts, in
 * bytes. Must stay in sync with MAX_CONTENT_LENGTH in
 * prettier-service/json-rpc.js (the service's frame cap) minus
 * headroom for the JSON-RPC envelope (method, id, protocol fields),
 * which isn't part of the measured params serialization.
 * @type {number}
 */
const MAX_REQUEST_BODY = 41 * 1024 * 1024

/**
 * Serialize a JSON-RPC request body exactly as the transport will and
 * measure its UTF-8 size. Measuring the real stringification is exact
 * — it captures JSON escaping (quotes, backslashes, control chars),
 * which can expand the payload well beyond the raw text size.
 *
 * @param {object} params
 * @returns {{ body: string, bytes: number }}
 */
function measureRequestBody(params) {
  const body = JSON.stringify(params)
  return { body, bytes: utf8ByteLength(body) }
}

class Formatter {
  constructor() {
    this.prettierServiceDidExit = this.prettierServiceDidExit.bind(this)
    this.prettierServiceStartDidFail =
      this.prettierServiceStartDidFail.bind(this)
    this.prettierServiceDidCrash = this.prettierServiceDidCrash.bind(this)

    /** @type {Map<string,number>} latest in-flight request IDs per file URI */
    this._latestRequestIds = new Map()
    /** @type {Set<Promise>} format requests currently in flight */
    this._pendingFormats = new Set()
    /**
     * Reject functions of in-flight format requests, fired when the
     * service exits so in-flight requests settle instead of dangling
     * on a dead transport.
     * @type {Set<(err: Error) => void>}
     */
    this._exitRejectors = new Set()
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
    /** true after dispose() — no more starts, crash restarts, or notices */
    this._disposed = false
    /**
     * Module path the running service was started with. Set only after a
     * successful start() and never cleared — it is the single source of
     * truth for "which Prettier module the service runs (or last ran)",
     * used by the crash-restart and the bundled-plugin gates.
     */
    this.runningPath = null

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

  get disposed() {
    return this._disposed === true
  }

  /** Public read of the most recent failure reason since the last start. */
  get lastFailure() {
    return this._lastFailure
  }

  /**
   * Public read of the external plugins seen in the most recent format,
   * for the Prettier Info command.
   */
  get lastFormatReport() {
    return {
      loaded: this._lastLoadedPlugins,
      unresolved: this._lastUnresolvedPlugins,
      disabled: this._lastDisabledPlugins,
    }
  }

  /**
   * Mark the start of or return from a planned stop/restart cycle. While
   * a planned restart is active, a momentarily missing service must not
   * surface the "Prettier Stopped Running" notification, and format
   * callers quietly skip instead of erroring.
   *
   * @param {boolean} active
   */
  setPlannedRestart(active) {
    this._restarting = active
  }

  /**
   * Stop all formatter activity for this instance. Must be called before
   * the owning extension tears down — no starts, crash restarts, or
   * notifications afterwards.
   */
  dispose() {
    this._disposed = true
  }

  async start(modulePath) {
    if (this.disposed) return

    if (!modulePath) {
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
    // (see the options.plugins gate in the format request) — surface
    // missing entry files here.
    const bundledMode = modulePath?.includes(nova.extension.path)
    reportMissingBundledPlugins(bundledMode)

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
          modulePath,
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

    // start() raises if the executable can't be launched — settle the
    // handshake and readiness so no awaiter dangles, then surface the
    // failure to the retry loop.
    try {
      proc.start()
    } catch (err) {
      this._startHandshake = null
      this._rejectStartHandshake(err)
      if (this._resolveIsReadyPromise) this._resolveIsReadyPromise(false)
      this._isReadyPromise = null
      this.prettierService = null
      throw err
    }

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

    // The service is running this module — record it as the single
    // source of truth for callers (restart redundancy, Prettier Info,
    // bundled-plugin gating).
    this.runningPath = modulePath
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

    // The terminate above triggers onDidExit, which fires the rejectors;
    // fire them here too so a wedged transport that never reports exit
    // can't leave in-flight requests dangling.
    this.rejectInFlightRequests()

    // escalate to SIGKILL if it hasn't exited in 5s
    this._forceStopTimer = setTimeout(() => {
      this._forceStopTimer = null
      if (this._isStoppedPromise) {
        log.error('Prettier did NOT exit in 5000ms, forcing stop.')
        try {
          proc.kill()
        } catch {
          // already exited
        }
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
   * Reject every in-flight format request. Fired when the service exits
   * or a stop is underway: the transport behind the requests is (or was)
   * going away, and an unanswered request would otherwise dangle
   * forever. No timer involved — purely event-driven.
   */
  rejectInFlightRequests() {
    if (!this._exitRejectors) return
    for (const reject of this._exitRejectors) {
      reject(new Error('Prettier service exited during format'))
    }
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
    // In-flight format requests must settle — the transport behind
    // them died. Fire before any early return below.
    this.rejectInFlightRequests()

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

    // Disposed extension — never respawn the service.
    if (this.disposed) return

    log.debug('Restarting Prettier…')
    // The service only crashes after a successful start, so runningPath
    // always holds the path to restart with here.
    this.start(this.runningPath).catch(() => {
      // startDidFail already surfaced the reason via notification
    })
  }

  prettierServiceDidCrash({ parameters }) {
    // Sent right before exit after an uncaughtException/unhandledRejection
    // — prettierServiceDidExit restarts and notifies. Without this the
    // crash reason is lost, leaving only an opaque IPC rejection.
    const { name, message, stack } = parameters ?? {}
    this._lastFailure = rehydrateError(parameters)
    this._lastFailureIsSpecific = true
    log.error(
      `Prettier service crashed: ${name ?? 'Unknown'}: ${message ?? 'no message'}${stack ? `\n${stack}` : ''}`,
    )
  }

  prettierServiceStartDidFail({ parameters: error }) {
    if (this._resolveIsReadyPromise) this._resolveIsReadyPromise(false)
    this._lastFailure = rehydrateError(error)
    this._lastFailureIsSpecific = true

    // Wake the awaiting start() caller with the actual failure reason.
    if (this._startHandshake) {
      this._startHandshake = null
      this._rejectStartHandshake(rehydrateError(error))
    }

    // Disposed extension — the handshake is settled, don't throw a
    // notification at the user during teardown.
    if (this.disposed) return

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
    // Disposed extension — no stray "stopped running" notices on teardown.
    if (this.disposed) return

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

    // Disposed extension — no format requests after deactivation.
    if (this._disposed) return []

    // Skip files larger than 32 MiB — stays within the IPC payload limit.
    const MAX_FILE_SIZE = 32 * 1024 * 1024 // 32 MiB
    if (document.length > MAX_FILE_SIZE) {
      notifyFileTooLarge(document.length)
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
        log.warn(
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
      notifyFileTooLarge(originalByteLength)
      return []
    }

    // Compose plugins and options: plugin gating/ordering, option
    // merging and the SQL formatter routing (which can skip a format
    // entirely for an unsupported dialect).
    const composed = composeFormatRequest({
      syntaxKey,
      document,
      editor,
      runningPath: this.runningPath,
      customConfigFile,
      ignoreConfigFile,
      applyDefaultConfig: shouldApplyDefaultConfig,
      selectionOnly,
    })

    if (composed.mismatch) {
      return notifySqlDialectMismatch(
        composed.mismatch.dialect,
        composed.mismatch.selected,
      )
    }
    if (composed.skip) return []

    const { options } = composed

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

    const formatParams = {
      original,
      pathForConfig,
      ignorePath: flags.force ? null : this.getIgnorePath(pathForConfig),
      options: {
        ...options,
        cursorOffset: editor.selectedRange.start,
      },
      withCursor: true,
    }

    // Serialize the request exactly as the transport will and measure
    // it. The raw-byte guard above can't see JSON escaping (quotes,
    // backslashes, control chars) which can expand the payload well
    // past the service's frame cap — an oversized frame would be
    // dropped silently at the other end. Reject here instead.
    const measured = measureRequestBody(formatParams)
    if (measured.bytes > MAX_REQUEST_BODY) {
      notifyFileTooLarge(measured.bytes)
      return []
    }

    const last = this._latestRequestIds.get(uri) || 0
    const requestId = last + 1
    this._latestRequestIds.set(uri, requestId)

    // Track as in-flight so a pending restart can wait for it to
    // settle before stopping the service.
    let rejectOnExit
    const exitPromise = new Promise((_, reject) => {
      rejectOnExit = reject
    })
    this._exitRejectors.add(rejectOnExit)
    const pending = (async () => {
      try {
        return await Promise.race([
          this.prettierService.request('format', formatParams),
          exitPromise,
        ])
      } catch (err) {
        if (
          err &&
          typeof err.message === 'string' &&
          err.message.includes('too large to transmit')
        ) {
          notifyResultTooLarge(err.data)
          return null
        }
        log.error(
          `Prettier IPC error in format: ${err.name}: ${err.message}\n${err.stack}`,
        )
        return null
      } finally {
        this._exitRejectors.delete(rejectOnExit)
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
      showConfigPluginsNotice(unresolvedPlugins, configFile)
    }

    if (disabledPlugins?.length) {
      showDisabledPluginsNotice(disabledPlugins)
    }

    // The service couldn't load the user's custom config file — show it
    // instead of silently formatting without it. Cancelled once the
    // config loads again.
    if (configError) {
      showCustomConfigErrorNotice(configError)
    } else {
      cancelNotification('prettier-custom-config-error')
      clearCustomConfigErrorNotice()
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
      return prettierErrorToIssues(
        // The service serializes thrown errors as plain objects over
        // JSON-RPC — rehydrate a real Error so message shows in logs.
        rehydrateError(error),
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
    // Untitled document outside a workspace: no directory to anchor
    // `.prettierignore` against — skip the ignore check entirely.
    if (!nova.workspace.path && !path) return null
    const expectedIgnoreDir = nova.workspace.path || nova.path.dirname(path)
    return nova.path.join(expectedIgnoreDir, '.prettierignore')
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
}

module.exports = {
  Formatter,
  MAX_REQUEST_BODY,
  measureRequestBody,
  utf8ByteLength,
}
