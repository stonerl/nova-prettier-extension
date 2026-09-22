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

const findPrettier = require('./module-resolver.js')

const {
  debouncePromise,
  getConfigWithWorkspaceOverride,
  log,
  observeConfigWithWorkspaceOverride,
  observeEmptyArrayCleanup,
  sanitizePrettierConfig,
} = require('./helpers.js')

const { showNotification } = require('./notifications.js')
const { Formatter } = require('./formatter.js')

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

    // initialize disposables containers
    this.fsWatchers = []
    this.commandDisposables = []
    this.configDisposables = []
    this.saveListeners = new Map()

    this.customConfigWatcher = null

    // debouncers
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

  /**
   * Watch the user’s external config-file (prettier.config.file),
   * tear down any old watcher, set up a new one, then trigger a restart.
   */
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
        this.debouncedModulePathOrPreferBundledDidChangeFast,
      ),
      ...observeConfigWithWorkspaceOverride(
        'prettier.module.preferBundled',
        this.modulePreferBundledDidChange,
      ),
      // restart when the user changes the external config-file path
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

    // immediately wire up the custom‐config watcher on load
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
    // activation has returned. Nova's config store can deadlock — a
    // config write waits for its synchronous change-notification
    // observers, which re-enter config reads behind a writer-priority
    // rwlock — when two extensions touch config concurrently during
    // activation (e.g. alongside Docker Suite). Keeping activate()
    // free of config-store traffic shrinks that window.
    this.configSetupTimer = setTimeout(() => {
      this.configSetupTimer = null
      this.setupConfiguration()
      this.syncSelectionUnsupportedContext()
    }, 0)

    // 1) File‐system watchers
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

    // 2) Workspace text‐editor listener
    this.didAddTextEditorDisposable = nova.workspace.onDidAddTextEditor(
      this.didAddTextEditor,
    )

    // 3) Commands
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
        this.modulePathDidChange,
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
    ]

    // Normalize boolean or Promise into a Promise<boolean>
    const readyPromise = Promise.resolve(this.formatter.isReady)

    // Initial service start. Config observers skip their initial
    // "current value" notification, so nothing else triggers this on a
    // fresh activation — kick it off explicitly. Fire-and-forget:
    // modulePathDidChange catches internally and surfaces failures as
    // notifications.
    this.modulePathDidChange()

    readyPromise.then((didStart) => {
      if (!didStart) return

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
    let path = this.modulePath
    if (!path) {
      log.info('Resolving Prettier installation…')
      path = await findPrettier()
    }

    log.info(`Loading prettier at ${path}`)

    const MAX_ATTEMPTS = 3
    const RETRY_DELAY_MS = 1000

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        await this.formatter.start(path)
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
    // Delegate to modulePathDidChange so failures surface through
    // its existing notification handling instead of rejecting unhandled.
    await this.modulePathDidChange()
  }

  async prettierConfigFileDidChange() {
    if (this.configIgnore && !this.configFile) return

    log.debug('prettierConfigFileDidChange invoked')
    this.debouncedReloadPrettierOnConfigChange()
  }

  async npmPackageFileDidChange() {
    if (this.preferBundled || this.modulePath) return

    log.debug('npmPackageFileDidChange invoked')
    this.debouncedModulePathDidChange()
  }

  async modulePreferBundledDidChange() {
    if (!this.hasStarted) return
    log.debug(
      'modulePreferBundledDidChange invoked — preferBundled: ',
      this.preferBundled,
    )
    this.debouncedModulePathOrPreferBundledDidChangeFast()
  }

  async moduleProjectPrettierDidChange() {
    if (this.preferBundled || this.modulePath) return

    log.debug('moduleProjectPrettierDidChange invoked')
    this.debouncedModulePathDidChange()
  }

  async modulePathDidChange() {
    // Mark the restart as planned so a momentarily missing service doesn't
    // surface the "Prettier Stopped Running" notification, and wait for any
    // in-flight format requests (e.g. a save-triggered format) to settle
    // before stopping the service.
    this.formatter._restarting = true
    try {
      await this.formatter.waitForPendingFormats()

      await this.formatter.stop()
      await this.startFormatter()
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
        body: nova.localize(
          'prettier.notification.prettier-start-failed.body',
          'Please check the Extension Console for additional logs.',
          'notification',
        ),
      })
      return
    } finally {
      // Never leave the flag set — otherwise genuine failures would be
      // silently suppressed for the rest of the session.
      this.formatter._restarting = false
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

  async didInvokeFormatCommand(editor) {
    await this._formatEditor(editor)
  }

  async didInvokeFormatForcedCommand(editor) {
    await this._formatEditor(editor, { forced: true })
  }

  async didInvokeFormatSelectionCommand(editor) {
    // 1) Ask the formatter what the real syntax key is
    const syntaxKey = this.formatter.getSyntaxKey(editor)

    // 2) Which keys we support selection for:
    const supported = new Set([
      'javascript',
      'jsx',
      'typescript',
      'tsx',
      'graphql',
      'handlebars',
    ])

    // 3) Bail out if this syntax isn’t in our set
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
        '“Format Selection” isn’t available for this file type. Supported syntaxes: JavaScript, TypeScript, GraphQL, and Handlebars.\n\nClicking “Dismiss” will disable the command for unsupported syntaxes.',
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
   *
   * @throws {Error} if `forced` is true alongside `isSaving` or `selectionOnly`
   *
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

  dispose() {
    // 0) cancel deferred config setup so it never registers anything
    //    on a disposed instance
    if (this.configSetupTimer) {
      clearTimeout(this.configSetupTimer)
      this.configSetupTimer = null
    }

    // 1) stop the Prettier subprocess
    this.formatter.stop()

    // 2) dispose all fs.watch listeners
    for (const watcher of this.fsWatchers) {
      watcher.dispose()
    }
    this.fsWatchers = []

    // 3) dispose all of commands
    for (const cmd of this.commandDisposables) {
      cmd.dispose()
    }
    this.commandDisposables = []

    // 4) dispose the workspace.textEditor listener
    this.didAddTextEditorDisposable.dispose()
    this.didAddTextEditorDisposable = null

    // 5) dispose all save‑listeners
    for (const listener of this.saveListeners.values()) {
      listener.dispose()
    }
    this.saveListeners.clear()

    // 6) clear debounce timers
    this.debouncedModulePathDidChange.cancel()
    this.debouncedReloadPrettierOnConfigChange.cancel()
    this.debouncedModulePathOrPreferBundledDidChangeFast.cancel()

    // 7) tear down config observers
    for (const d of this.configDisposables) d.dispose()
    this.configDisposables = []
  }
}

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

exports.deactivate = function () {
  if (prettierExtensionInstance) {
    prettierExtensionInstance.dispose()
    prettierExtensionInstance = null
  }
}
