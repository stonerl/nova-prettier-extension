/**
 * main.js — Nova extension entry point for Prettier⁺
 *
 * @license MIT
 * @author Alexander Weiss, Toni Förster
 * @copyright © 2023 Alexander Weiss, © 2025 Toni Förster
 *
 * Initializes and manages the Prettier⁺ extension, including commands, event hooks, and workspace observers.
 */

let prettierExtensionInstance = null

const { findPrettier } = require('./module-resolver.js')

const {
  debouncePromise,
  getCliVersion,
  getConfigWithWorkspaceOverride,
  getNpmVersion,
  isInsideExtensionBundle,
  log,
  observeConfigWithWorkspaceOverride,
  observeEmptyArrayCleanup,
  readJsonFile,
  sanitizePrettierConfig,
} = require('./helpers.js')

const {
  showNotification,
  describeFailure,
  withReason,
} = require('./notifications.js')
const { Formatter, findMissingBundledPlugins } = require('./formatter.js')
const pluginPaths = require('./prettier-plugins.js')
const { projectChoices, resolveCommand } = require('./settings.js')
const { WORKSPACE_CHOICES } = require('./workspace-choices.js')

/**
 * Finds a bundled plugin's package root from its registry entry path:
 * entries point at entry files of varying depth, so walk up until the
 * parent is `node_modules` itself or an `@scope` directory under it.
 *
 * @param {string} pluginPath – absolute entry file path from the registry
 * @returns {string|null}      – the plugin's package directory, or null
 */
function pluginPackageDir(pluginPath) {
  let dir = nova.path.dirname(pluginPath)
  for (let hops = 0; hops < 8; hops++) {
    const parent = nova.path.dirname(dir)
    const base = parent.split('/').pop()
    if (base === 'node_modules' || base.startsWith('@')) return dir
    dir = parent
  }
  return null
}

class PrettierExtension {
  constructor() {
    this.didAddTextEditor = this.didAddTextEditor.bind(this)
    this.toggleFormatOnSave = this.toggleFormatOnSave.bind(this)
    this.modulePathDidChange = this.modulePathDidChange.bind(this)
    this.modulePreferBundledDidChange =
      this.modulePreferBundledDidChange.bind(this)
    this.moduleProjectPrettierDidChange =
      this.moduleProjectPrettierDidChange.bind(this)
    this.prettierConfigFileDidChange =
      this.prettierConfigFileDidChange.bind(this)
    this.npmPackageFileDidChange = this.npmPackageFileDidChange.bind(this)
    this.handleCustomConfigPathChange =
      this.handleCustomConfigPathChange.bind(this)
    this.editorWillSave = this.editorWillSave.bind(this)
    this.didInvokeFormatCommand = this.didInvokeFormatCommand.bind(this)
    this.didInvokeFormatSelectionCommand =
      this.didInvokeFormatSelectionCommand.bind(this)
    this.didInvokeFormatForcedCommand =
      this.didInvokeFormatForcedCommand.bind(this)
    this.didInvokeSaveWithoutFormattingCommand =
      this.didInvokeSaveWithoutFormattingCommand.bind(this)

    this.ignoredEditors = new Set()
    this.issueCollection = new IssueCollection()

    this.fsWatchers = []
    this.commandDisposables = []
    this.configDisposables = []
    this.saveListeners = new Map()

    this.customConfigWatcher = null

    // Shared 5s debouncer for all "restart module" triggers — package
    // file changes, project Prettier updates, and the restart command
    // all funnel into modulePathDidChange. One instance prevents
    // concurrent stop/start interleavings when multiple triggers fire.
    this.debouncedModulePathDidChange = debouncePromise(
      this.modulePathDidChange,
      5000,
    )
    this.debouncedReloadPrettierOnConfigChange = debouncePromise(
      () => this.reloadPrettierConfig(),
      2000,
    )
    this.debouncedModulePathOrPreferBundledDidChangeFast = debouncePromise(
      this.modulePathDidChange,
      1000,
    )

    this.formatter = new Formatter()
    this.hasStarted = false
    /** true after dispose() — all async work must bail */
    this._disposed = false

    // Module-path resolution cache: findPrettier() shells out to npm and
    // can take many seconds. Config-file changes restart the service but
    // never change which Prettier to load, so the resolved path is
    // reused until a resolution-affecting trigger fires.
    this._resolvedModulePath = null
    this._needsResolution = true

    // In-flight stop/start cycle (singleflight — see _runRestartCycle)
    this._restartCycle = null
    // trigger joined an in-flight cycle — schedule one more run
    // after it finishes instead of dropping it
    this._restartCycleQueued = false

    // Path the running service was started with. Redundant triggers
    // (observers re-firing with unchanged values during startup) resolve
    // to the same effective path — the stop/start is skipped instead of
    // bouncing a healthy service.
    this._runningModulePath = null
    // config-file edits must restart the service even when the module
    // path is unchanged
    this._forceRestart = false
  }

  get preferBundled() {
    return getConfigWithWorkspaceOverride('prettier.module.preferBundled')
  }

  get modulePath() {
    return getConfigWithWorkspaceOverride('prettier.module.path')
  }

  get configIgnore() {
    return getConfigWithWorkspaceOverride('prettier.config.ignore')
  }

  get configFile() {
    return getConfigWithWorkspaceOverride('prettier.config.file')
  }

  handleCustomConfigPathChange() {
    if (this.customConfigWatcher) {
      this.customConfigWatcher.dispose()
      this.fsWatchers = this.fsWatchers.filter(
        (watcher) => watcher !== this.customConfigWatcher,
      )
      this.customConfigWatcher = null
      this.configSetupTimer = null
    }

    if (this.configFile) {
      const watchPath = nova.workspace.path
        ? nova.path.join(nova.workspace.path, this.configFile)
        : this.configFile

      try {
        this.customConfigWatcher = nova.fs.watch(
          watchPath,
          this.prettierConfigFileDidChange,
        )
        this.fsWatchers.push(this.customConfigWatcher)
      } catch (err) {
        log.error('Failed to watch custom Prettier config file', err)
      }
    }

    // only schedule reloads once we've fully started
    if (this.hasStarted) {
      this.debouncedReloadPrettierOnConfigChange()
    }
  }

  setupConfiguration() {
    log.debug(
      `Nova Version: ${nova.versionString}\n` +
        `Extension Version: ${nova.extension.version}`,
    )

    // Legacy key cleanup — only write when a legacy key is actually
    // present. Unconditional removes performed a config write on every
    // activation, contending with other extensions' config access and
    // widening the window for Nova's config-store activation deadlock.
    for (const legacyKey of [
      'prettier.use-compatibility-mode',
      'prettier.default-config.jsxBracketSameLine',
    ]) {
      if (nova.config.get(legacyKey) !== null) {
        nova.config.remove(legacyKey)
      }
    }

    sanitizePrettierConfig()

    this.configDisposables.push(
      ...observeConfigWithWorkspaceOverride(
        'prettier.module.path',
        // Log the trigger — this observer is otherwise silent, and Nova
        // re-notifies it with unchanged values during startup.
        (...args) => {
          log.debug(
            "Config 'prettier.module.path' notified — restart requested",
          )
          this.debouncedModulePathOrPreferBundledDidChangeFast(...args)
        },
      ),
      ...observeConfigWithWorkspaceOverride(
        'prettier.module.preferBundled',
        this.modulePreferBundledDidChange,
      ),
      ...observeConfigWithWorkspaceOverride(
        'prettier.config.file',
        this.handleCustomConfigPathChange,
      ),
    )

    observeEmptyArrayCleanup(
      [
        'prettier.plugins.prettier-plugin-tailwind.tailwindAttributes',
        'prettier.plugins.prettier-plugin-tailwind.tailwindFunctions',
        'prettier.plugins.prettier-plugin-twig.twigTestExpressions',
        'prettier.plugins.prettier-plugin-twig.twigMultiTags',
      ],
      this.configDisposables,
    )

    this.handleCustomConfigPathChange()
  }

  syncSelectionUnsupportedContext() {
    const dismissed =
      nova.config.get('prettier.selection-unsupported.dismissed') === true

    // Only write when the mirrored value actually differs — context
    // writes go through the same Nova config store as extension config,
    // so an unconditional set on every activation is needless contention.
    const current = nova.workspace.context.get(
      'prettier.selectionUnsupportedDismissed',
    )
    if (current !== dismissed) {
      nova.workspace.context.set(
        'prettier.selectionUnsupportedDismissed',
        dismissed,
      )
    }
  }

  start() {
    // Config writes and observer registration are deferred until after
    // activation. Nova's config store can deadlock when two extensions
    // touch config concurrently during activation — a config write waits
    // for its synchronous change-notification observers, which re-enter
    // config reads behind a writer-priority rwlock. Keeping activate()
    // free of config-store traffic shrinks that window.
    this.configSetupTimer = setTimeout(() => {
      this.configSetupTimer = null
      this.setupConfiguration()
      this.syncSelectionUnsupportedContext()
    }, 0)

    // File-system watchers
    if (nova.workspace.path) {
      const configFilesToWatch = [
        '**/.prettierrc',
        '**/.prettierrc.json',
        '**/.prettierrc.json5',
        '**/.prettierrc.yaml',
        '**/.prettierrc.yml',
        '**/.prettierrc.toml',
        '**/.prettierrc.js',
        '**/.prettierrc.cjs',
        '**/.prettierrc.mjs',
        '**/.prettierrc.ts',
        '**/.prettierrc.cts',
        '**/.prettierrc.mts',
        '**/prettier.config.js',
        '**/prettier.config.cjs',
        '**/prettier.config.mjs',
        '**/prettier.config.ts',
        '**/prettier.config.cts',
        '**/prettier.config.mts',
        '**/.prettierignore',
        '**/.editorconfig',
      ]

      for (const pattern of configFilesToWatch) {
        const watcher = nova.fs.watch(pattern, this.prettierConfigFileDidChange)
        this.fsWatchers.push(watcher)
      }

      const npmFilesToWatch = [
        'package.json',
        'package.yaml',
        'package-lock.json',
        'yarn.lock',
        'pnpm-lock.yaml',
      ]

      for (const pattern of npmFilesToWatch) {
        const watcher = nova.fs.watch(pattern, this.npmPackageFileDidChange)
        this.fsWatchers.push(watcher)
      }

      const nodeModulesWatcher = nova.fs.watch(
        'node_modules/prettier/**',
        this.moduleProjectPrettierDidChange,
      )
      this.fsWatchers.push(nodeModulesWatcher)
    }

    // Text-editor listener
    this.didAddTextEditorDisposable = nova.workspace.onDidAddTextEditor(
      this.didAddTextEditor,
    )

    // Commands
    this.commandDisposables = [
      nova.commands.register('prettier.format', this.didInvokeFormatCommand),

      nova.commands.register(
        'prettier.format-selection',
        this.didInvokeFormatSelectionCommand,
      ),

      nova.commands.register(
        'prettier.format-forced',
        this.didInvokeFormatForcedCommand,
      ),

      nova.commands.register(
        'prettier.save-without-formatting',
        this.didInvokeSaveWithoutFormattingCommand,
      ),

      nova.commands.register(
        'prettier.restart-service',
        // An explicit restart should do a fresh resolution and always
        // bounce the service — "restart" means restart, even if the
        // resolved path turns out to be unchanged.
        async () => {
          this._needsResolution = true
          this._forceRestart = true
          await this.modulePathDidChange()
        },
      ),

      nova.commands.register('prettier.reset-suppressed-message', () => {
        nova.config.remove('prettier.selection-unsupported.dismissed')
        nova.workspace.context.set(
          'prettier.selectionUnsupportedDismissed',
          false,
        )
        nova.workspace.showInformativeMessage(
          nova.localize(
            'prettier.notification.formatSelection.restored.message',
            'Prettier⁺ notification restored. “Format Selection” will now reappear in the menu for unsupported syntaxes, showing a warning when used.',
            'notification',
          ),
        )
      }),
      nova.commands.register('prettier.open-help', () => {
        nova.extension.openHelp()
      }),

      nova.commands.register('prettier.info', async () => {
        await this.showPrettierInfo()
      }),

      // Project Settings enum resolve commands: Nova re-requests the
      // choices every time the pane is shown, so the "Global Setting"
      // option can name the preference's current value. Passed as a
      // receiver-wrapped closure — nova.localize is an Objective-C
      // bridge method and throws "self type check failed" when invoked
      // detached.
      ...Object.keys(WORKSPACE_CHOICES).map((key) =>
        nova.commands.register(resolveCommand(key), () =>
          projectChoices(key, nova.config.get(key), (k, fallback) =>
            nova.localize(k, fallback),
          ),
        ),
      ),
    ]

    // Initial service start: config observers skip their initial
    // "current value" notification, so nothing triggers this on a fresh
    // activation. Fire-and-forget — modulePathDidChange catches
    // internally and surfaces failures as notifications.
    this.modulePathDidChange()

    const readyPromise = Promise.resolve(this.formatter.isReady)

    readyPromise.then((didStart) => {
      if (!didStart || this._disposed) return

      this.hasStarted = true

      const disposables = observeConfigWithWorkspaceOverride(
        'prettier.format-on-save',
        this.toggleFormatOnSave,
      )
      this.configDisposables.push(...disposables)
      this.toggleFormatOnSave()
    })
  }

  async startFormatter() {
    // An explicitly configured module path always wins and never touches
    // the resolution cache.
    if (this.modulePath) {
      await this._startWithModulePath(this.modulePath)
      return
    }

    // Config-change restarts reuse the cached path; triggers that can
    // affect resolution (package files, node_modules, preferBundled)
    // set _needsResolution first.
    let path = this._resolvedModulePath
    const fromCache = !!path && !this._needsResolution
    if (!path || this._needsResolution) {
      log.info('Resolving Prettier installation…')
      path = await findPrettier()
      this._resolvedModulePath = path
      this._needsResolution = false
    }

    try {
      await this._startWithModulePath(path)
    } catch (err) {
      // The cached path may be stale (e.g. node_modules was wiped while
      // no watcher fired) — re-resolve once before giving up. A freshly
      // resolved path already reflects the current state, so retrying
      // with another resolution would be pointless.
      if (!fromCache) throw err
      log.warn('Starting with cached module path failed, re-resolving…', err)
      path = await findPrettier()
      this._resolvedModulePath = path
      this._needsResolution = false
      await this._startWithModulePath(path)
    }
  }

  /**
   * Starts the service at the given module path, attempting up to three
   * times with a fixed delay between attempts.
   *
   * @param {string} path — resolved Prettier module directory
   * @private
   */
  async _startWithModulePath(path) {
    log.info(`Loading prettier at ${path}`)

    const MAX_ATTEMPTS = 3
    const RETRY_DELAY_MS = 1000

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        await this.formatter.start(path)
        this._runningModulePath = path
        return
      } catch (err) {
        if (attempt === MAX_ATTEMPTS) throw err
        log.warn(
          `Starting Prettier service failed (attempt ${attempt}/${MAX_ATTEMPTS}), retrying in ${RETRY_DELAY_MS}ms`,
          err,
        )
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
      }
    }
  }

  toggleFormatOnSave() {
    this.enabled = getConfigWithWorkspaceOverride('prettier.format-on-save')

    if (this.enabled) {
      nova.workspace.textEditors.forEach(this.didAddTextEditor)
    } else {
      this.saveListeners.forEach((listener) => listener.dispose())
      this.saveListeners.clear()
    }
  }

  async reloadPrettierConfig() {
    log.debug('Prettier config file changed — restarting Prettier…')
    // config-file edits must restart even when the module path is unchanged
    this._forceRestart = true
    // delegate so failures surface via modulePathDidChange's notification
    // handling instead of rejecting unhandled
    await this.modulePathDidChange()
  }

  async prettierConfigFileDidChange() {
    if (this.configIgnore && !this.configFile) return

    log.debug('prettierConfigFileDidChange invoked')
    this.debouncedReloadPrettierOnConfigChange()
  }

  async npmPackageFileDidChange(path) {
    if (this.preferBundled || this.modulePath) return

    // The bundled install itself writes package files into the
    // extension bundle — self-induced events whose result the running
    // resolution already picked up; restarting would only cause a
    // redundant stop/start cycle.
    if (isInsideExtensionBundle(path)) {
      log.debug('Ignoring self-induced watcher event:', path)
      return
    }

    log.debug('npmPackageFileDidChange invoked:', path)
    this._needsResolution = true
    this.debouncedModulePathDidChange()
  }

  async modulePreferBundledDidChange() {
    if (!this.hasStarted) return
    log.debug(
      'modulePreferBundledDidChange invoked — preferBundled: ',
      this.preferBundled,
    )
    // switching between bundled and project Prettier changes resolution
    this._needsResolution = true
    this.debouncedModulePathOrPreferBundledDidChangeFast()
  }

  async moduleProjectPrettierDidChange(path) {
    if (this.preferBundled || this.modulePath) return

    // Same as above: events under the extension bundle are the bundled
    // install's own writes, not a project Prettier appearing.
    if (isInsideExtensionBundle(path)) {
      log.debug('Ignoring self-induced watcher event:', path)
      return
    }

    log.debug('moduleProjectPrettierDidChange invoked:', path)
    this._needsResolution = true
    this.debouncedModulePathDidChange()
  }

  /**
   * True when a stop/start cycle would change nothing: no resolution was
   * requested, the service is healthy, and the effective module path is
   * the one the running service was started with. Config observers
   * re-fire with unchanged values during startup (Nova re-notifies on
   * config-store reloads) — without this check each notification bounces
   * the service through a full stop/start.
   *
   * @private
   * @returns {boolean}
   */
  _isRestartRedundant() {
    if (this._forceRestart || this._needsResolution) return false
    if (!this.formatter.isRunning()) return false

    const effectivePath = this.modulePath ?? this._resolvedModulePath
    return !!effectivePath && effectivePath === this._runningModulePath
  }

  /**
   * Runs one full stop/start cycle. Concurrent triggers coalesce into the
   * running cycle instead of spawning a second resolution/install — a
   * slow resolution (e.g. first-run npm install) combined with watcher
   * storms from npm's own writes would otherwise run them in parallel and
   * fail with ENOTEMPTY races. Cycles that would change nothing (healthy
   * service, same effective module path) are skipped entirely.
   *
   * @private
   * @returns {Promise<void>}
   */
  _runRestartCycle() {
    if (this._disposed) return Promise.resolve()

    if (this._restartCycle) {
      // Trigger arrived while a cycle was already running — remember it
      // so a fresh cycle runs after this one finishes, otherwise it
      // would be silently dropped (e.g. npm install finishing mid-cycle
      // never re-resolves the module path).
      this._restartCycleQueued = true
      return this._restartCycle
    }

    this._restartCycle = (async () => {
      if (this._disposed) return

      // Resolution: the service stays up, so formatting keeps working
      // while npm ls runs. Only resolution-affecting triggers set
      // _needsResolution; an explicit module path makes it pointless.
      if (this._needsResolution && !this.modulePath) {
        try {
          const path = await findPrettier()
          this._resolvedModulePath = path
        } finally {
          this._needsResolution = false
        }
      }

      // Stop/start only when something actually changed — a trigger that
      // resolves to the same path must not bounce a healthy service.
      if (this._isRestartRedundant()) {
        log.debug('Module path and config unchanged — skipping restart')
        return
      }

      // Mark the restart as planned so a momentarily missing service
      // doesn't surface the "Prettier Stopped Running" notification.
      this.formatter._restarting = true
      try {
        await this.formatter.waitForPendingFormats()
        await this.formatter.stop()
        await this.startFormatter()
        this._forceRestart = false
      } finally {
        // Never leave the flag set — otherwise genuine failures would be
        // silently suppressed for the rest of the session.
        this.formatter._restarting = false
      }
    })().finally(() => {
      this._restartCycle = null
      if (this._restartCycleQueued) {
        this._restartCycleQueued = false
        this.debouncedModulePathDidChange()
      }
    })
    return this._restartCycle
  }

  async modulePathDidChange() {
    // Diagnostic: one line per trigger showing exactly why the cycle
    // will run (or be skipped) — Nova re-notifies config observers with
    // unchanged values during startup, which used to bounce the service.
    const effectivePath = this.modulePath ?? this._resolvedModulePath
    log.debug(
      `Restart requested — needsResolution: ${this._needsResolution}, ` +
        `forceRestart: ${this._forceRestart}, ` +
        `serviceRunning: ${this.formatter.isRunning()}, ` +
        `pathMatchesRunning: ${
          !!effectivePath && effectivePath === this._runningModulePath
        }`,
    )
    try {
      await this._runRestartCycle()
    } catch (err) {
      if (err.status === 127) {
        await showNotification({
          id: 'prettier-resolution-error',
          title: nova.localize(
            'prettier.notification.prettier-not-found.title',
            'Can’t Find npm and Prettier',
            'notification',
          ),
          body: nova.localize(
            'prettier.notification.prettier-not-found.body',
            'Prettier can’t be found because npm isn’t available. Make sure Node is installed and accessible.\nIf you’re using NVM, adjust your shell configuration so Nova can load the environment correctly.\nSee Nova’s environment variables guide for help.',
            'notification',
          ),
          actions: [
            nova.localize(
              'prettier.notification.prettier-not-found.action.help',
              'Open Help Article',
              'notification',
            ),
            nova.localize(
              'prettier.notification.actions.ok',
              'OK',
              'notification',
            ),
          ],
          callback: (responseIdx) => {
            if (responseIdx === 0) {
              nova.openURL(
                'https://library.panic.com/nova/environment-variables/',
              )
            }
          },
        })
        return
      }

      log.error('Unable to start prettier service', err, err.stack)

      await showNotification({
        id: 'prettier-resolution-error',
        title: nova.localize(
          'prettier.notification.prettier-start-failed.title',
          'Unable to Start Prettier',
          'notification',
        ),
        body: withReason(
          nova.localize(
            'prettier.notification.prettier-start-failed.body',
            'Please check the Extension Console for additional logs.',
            'notification',
          ),
          describeFailure(err),
        ),
      })
      return
    }
  }

  didAddTextEditor(editor) {
    if (!this.enabled) return

    if (this.saveListeners.has(editor)) return
    this.saveListeners.set(editor, editor.onWillSave(this.editorWillSave))
  }

  async editorWillSave(editor) {
    await this._formatEditor(editor, { isSaving: true })
  }

  /**
   * Collects the lines for the Prettier Info command's message: which
   * Prettier is used and where it came from, its version, the service
   * state, Node/npm versions and the plugin picture.
   *
   * English-only on purpose — diagnostic output, mirroring the SQL
   * extension's language-server info dialog.
   *
   * @private
   * @returns {Promise<string[]>}
   */
  async _buildPrettierInfoLines() {
    const lines = []

    const explicit = this.modulePath
    const preferBundled = this.preferBundled
    const module = this._runningModulePath ?? this._resolvedModulePath

    let source
    if (explicit) {
      const scope =
        nova.workspace.config.get('prettier.module.path') != null
          ? 'workspace setting'
          : 'global setting'
      source = `Explicit module path (${scope})`
    } else if (preferBundled) {
      source = 'Bundled (preferBundled forced)'
    } else if (!module) {
      source = 'Not resolved yet'
    } else if (
      module === nova.path.join(nova.extension.path, 'node_modules', 'prettier')
    ) {
      source = 'Bundled'
    } else {
      source = 'Project'
    }
    lines.push(`Source: ${source}`)

    lines.push(`Module: ${module ?? 'not resolved yet'}`)

    let version = null
    if (module) {
      version =
        readJsonFile(nova.path.join(module, 'package.json'))?.version ?? null
    }
    lines.push(`Version: ${version ?? 'unknown'}`)

    lines.push(
      `Service: ${this.formatter.isRunning() ? 'running' : 'not running'}`,
    )
    const reason = describeFailure(this.formatter._lastFailure)
    if (reason) lines.push(`Last failure: ${reason}`)

    const [nodeVersion, npmVersion] = await Promise.all([
      getCliVersion('node'),
      getNpmVersion(),
    ])
    lines.push(`Node: ${nodeVersion} — npm: ${npmVersion}`)

    const missingPluginPaths = new Set(
      findMissingBundledPlugins().map((missing) => missing.path),
    )
    const pluginVersions = Object.entries(pluginPaths).map(
      ([name, pluginPath]) => {
        if (missingPluginPaths.has(pluginPath)) return `${name} (missing)`

        const packageDir = pluginPackageDir(pluginPath)
        const packagePath = packageDir
          ? nova.path.join(packageDir, 'package.json')
          : null
        const pkg = packagePath && readJsonFile(packagePath)
        return pkg?.version ? `${name} (${pkg.version})` : name
      },
    )
    lines.push(`Bundled plugins: ${pluginVersions.join(', ') || 'none'}`)

    lines.push(
      `External plugins (last format): ${
        this.formatter._lastLoadedPlugins.join(', ') || 'none seen this session'
      }`,
    )
    lines.push(
      `Unresolved plugins: ${
        this.formatter._lastUnresolvedPlugins.join(', ') || 'none'
      }`,
    )
    lines.push(
      `Disabled plugins: ${
        this.formatter._lastDisabledPlugins.join(', ') || 'none'
      }`,
    )

    return lines
  }

  async showPrettierInfo() {
    const lines = await this._buildPrettierInfoLines()
    await nova.workspace.showInformativeMessage(lines.join('\n'))
  }

  async didInvokeFormatCommand(editor) {
    await this._formatEditor(editor)
  }

  async didInvokeFormatForcedCommand(editor) {
    await this._formatEditor(editor, { forced: true })
  }

  async didInvokeFormatSelectionCommand(editor) {
    const syntaxKey = this.formatter.getSyntaxKey(editor)

    const supported = new Set([
      'javascript',
      'jsx',
      'typescript',
      'tsx',
      'graphql',
    ])

    if (!supported.has(syntaxKey)) {
      const suppressionKey = 'prettier.selection-unsupported.dismissed'
      const dismissed = nova.config.get(suppressionKey)
      if (dismissed === true) return

      const req = new NotificationRequest('prettier-selection-unsupported')
      req.title = nova.localize(
        'prettier.notification.unsupportedSyntax.title',
        'Unsupported Syntax',
        'notification',
      )
      req.body = nova.localize(
        'prettier.notification.unsupportedSyntax.body',
        '“Format Selection” isn’t available for this file type. Supported syntaxes: JavaScript, TypeScript, and GraphQL.\n\nClicking “Dismiss” will disable the command for unsupported syntaxes.',
        'notification',
      )
      req.actions = [
        nova.localize('prettier.notification.actions.ok', 'OK', 'notification'),
        nova.localize(
          'prettier.notification.actions.dismiss',
          'Dismiss',
          'notification',
        ),
      ]

      nova.notifications
        .add(req)
        .then((response) => {
          if (response.actionIdx === 1) {
            nova.config.set(suppressionKey, true)
            nova.workspace.context.set(
              'prettier.selectionUnsupportedDismissed',
              true,
            )
          }
        })
        .catch((err) => {
          log.error('Notification error:', err)
        })
      return
    }

    await this._formatEditor(editor, { selectionOnly: true })
  }

  async didInvokeSaveWithoutFormattingCommand(editor) {
    this.ignoredEditors.add(editor)
    editor.save().finally(() => this.ignoredEditors.delete(editor))
  }

  /**
   * Format an editor, with optional modes.
   *
   * @private
   * @param {TextEditor} editor
   * @param {Object} opts
   * @param {boolean} [opts.isSaving=false]      — invoked via the will-save hook
   * @param {boolean} [opts.selectionOnly=false] — format only the selected range
   * @param {boolean} [opts.forced=false]        — ignore user opts and always format
   *                                               cannot be combined with `isSaving` or `selectionOnly`
   * @throws {Error} if `forced` is true alongside `isSaving` or `selectionOnly`
   */
  async _formatEditor(
    editor,
    { isSaving = false, selectionOnly = false, forced = false } = {},
  ) {
    if (forced && (isSaving || selectionOnly)) {
      throw new Error(
        '`forced` cannot be used alongside `isSaving` or `selectionOnly`',
      )
    }

    if (this.ignoredEditors.has(editor)) return

    try {
      const ready = await this.formatter.isReady
      if (!ready) return

      const issues = forced
        ? await this.formatter.formatEditorForced(editor)
        : await this.formatter.formatEditor(editor, isSaving, selectionOnly)

      this.issueCollection.set(editor.document.uri, issues)
    } catch (err) {
      log.error(err, err.stack)
      await showNotification({
        id: 'prettier-format-error',
        title: nova.localize(
          'prettier.notification.format-error.title',
          'Error While Formatting',
          'notification',
        ),
        body:
          `"${err.message}"` +
          nova.localize(
            'prettier.notification.format-error.body',
            '\n\nSee the Extension Console for more info.',
            'notification',
          ),
      })
    }
  }

  async dispose() {
    // cancel deferred config setup so it never registers anything
    // on a disposed instance
    if (this.configSetupTimer) {
      clearTimeout(this.configSetupTimer)
      this.configSetupTimer = null
    }
    this._disposed = true
    // Suppresses crash-restarts, notifications, and format attempts on
    // the formatter while the restart cycle drains below.
    this.formatter._disposed = true

    // In-flight stop/start cycle: let it settle so it never spawns a
    // fresh service after deactivation.
    if (this._restartCycle) {
      try {
        await this._restartCycle
      } catch {
        // failures already surfaced via showNotification
      }
    }

    // Synchronous first stop would race the cycle's tail end — call
    // stop() after the cycle settles so terminate is not skipped while
    // a start() is still holding its handshake.
    await this.formatter.stop()

    for (const watcher of this.fsWatchers) {
      watcher.dispose()
    }
    this.fsWatchers = []

    for (const cmd of this.commandDisposables) {
      cmd.dispose()
    }
    this.commandDisposables = []

    this.didAddTextEditorDisposable.dispose()
    this.didAddTextEditorDisposable = null

    for (const listener of this.saveListeners.values()) {
      listener.dispose()
    }
    this.saveListeners.clear()

    this.debouncedModulePathDidChange.cancel()
    this.debouncedReloadPrettierOnConfigChange.cancel()
    this.debouncedModulePathOrPreferBundledDidChangeFast.cancel()

    for (const d of this.configDisposables) d.dispose()
    this.configDisposables = []

    this.issueCollection?.clear?.()
  }
}

exports.PrettierExtension = PrettierExtension

exports.activate = async function () {
  try {
    prettierExtensionInstance = new PrettierExtension()
    prettierExtensionInstance.start()
  } catch (err) {
    log.error('Unable to set up prettier service', err, err.stack)

    await showNotification({
      id: 'prettier-resolution-error',
      title: nova.localize(
        'prettier.notification.prettier-start-failed.title',
        'Unable to Start Prettier',
        'notification',
      ),
      body: nova.localize(
        'prettier.notification.prettier-start-failed.body',
        'Please check the Extension Console for additional logs.',
        'notification',
      ),
    })
    return
  }
}

exports.deactivate = async function () {
  if (prettierExtensionInstance) {
    await prettierExtensionInstance.dispose()
    prettierExtensionInstance = null
  }
}
