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
  showError,
  getConfigWithWorkspaceOverride,
  observeConfigWithWorkspaceOverride,
  log,
  sanitizePrettierConfig,
} = require('./helpers.js')
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
    this.nodeModulesChangeTimeout = null

    this.formatter = new Formatter()
    this.hasStarted = false
  }

  setupConfiguration() {
    nova.config.remove('prettier.use-compatibility-mode')
    nova.config.remove('prettier.plugins.prettier-plugin-php.singleQuote')
    sanitizePrettierConfig()

    this.configDisposables.push(
      ...observeConfigWithWorkspaceOverride(
        'prettier.format-on-save',
        this.toggleFormatOnSave,
      ),
      ...observeConfigWithWorkspaceOverride(
        'prettier.module.path',
        this.modulePathDidChange,
      ),
      ...observeConfigWithWorkspaceOverride(
        'prettier.module.preferBundled',
        this.modulePreferBundledDidChange,
      ),
    )
  }

  syncSelectionUnsupportedContext() {
    const dismissed =
      nova.config.get('prettier.selection-unsupported.dismissed') === true
    nova.workspace.context.set(
      'prettier.selectionUnsupportedDismissed',
      dismissed,
    )
  }

  start() {
    this.setupConfiguration()
    this.syncSelectionUnsupportedContext()
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
        '**/package.json',
        '**/package.yaml',
        '**/.prettierignore',
      ]

      for (const pattern of configFilesToWatch) {
        const watcher = nova.fs.watch(pattern, this.prettierConfigFileDidChange)
        this.fsWatchers.push(watcher)
      }

      const nodeModulesWatcher = nova.fs.watch(
        'node_modules/**',
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
    ]
    this.hasStarted = true
  }

  async startFormatter() {
    const path =
      getConfigWithWorkspaceOverride('prettier.module.path') ||
      (await findPrettier())

    log.info(`Loading prettier at ${path}`)
    await this.formatter
      .start(path)
      .catch(() =>
        new Promise((resolve) => setTimeout(resolve, 1000)).then(() =>
          this.formatter.start(path),
        ),
      )
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

  async prettierConfigFileDidChange() {
    log.debug('prettierConfigFileDidChange invoked')
    await this.modulePathDidChange()
  }

  async modulePreferBundledDidChange() {
    if (!this.hasStarted) return
    log.debug(
      `modulePreferBundledDidChange invoked — preferBundled: ${getConfigWithWorkspaceOverride('prettier.module.preferBundled')}`,
    )
    await this.modulePathDidChange()
  }

  async moduleProjectPrettierDidChange() {
    // Debounce the event so we only call modulePathDidChange() once per bulk update,
    // instead of triggering it for each module installation event.
    log.debug('moduleProjectPrettierDidChange invoked')
    if (this.nodeModulesChangeTimeout) {
      clearTimeout(this.nodeModulesChangeTimeout)
    }
    this.nodeModulesChangeTimeout = setTimeout(async () => {
      await this.modulePathDidChange()
      this.nodeModulesChangeTimeout = null
    }, 1000)
  }

  async modulePathDidChange() {
    try {
      await this.formatter.stop()
      await this.startFormatter()
    } catch (err) {
      if (err.status === 127) {
        return showActionableError(
          'prettier-resolution-error',
          nova.localize(
            'prettier.notification.prettier-not-found.title',
            'Can’t Find npm and Prettier',
            'notification',
          ),
          nova.localize(
            'prettier.notification.prettier-not-found.body',
            'Prettier can’t be found because npm isn’t available. Make sure Node is installed and accessible.\nIf you’re using NVM, adjust your shell configuration so Nova can load the environment correctly.\nSee Nova’s environment variables guide for help.',
            'notification',
          ),
          [
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
          (responseIdx) => {
            if (responseIdx === 0) {
              nova.openURL(
                'https://library.panic.com/nova/environment-variables/',
              )
            }
          },
        )
      }

      log.error('Unable to start prettier service', err, err.stack)

      return showError(
        'prettier-resolution-error',
        nova.localize(
          'prettier.notification.prettier-start-failed.title',
          'Unable to Start Prettier',
          'notification',
        ),
        nova.localize(
          'prettier.notification.prettier-start-failed.body',
          'Please check the Extension Console for additional logs.',
          'notification',
        ),
      )
    }
  }

  didAddTextEditor(editor) {
    if (!this.enabled) return

    if (this.saveListeners.has(editor)) return
    this.saveListeners.set(editor, editor.onWillSave(this.editorWillSave))
  }

  async editorWillSave(editor) {
    await this.formatEditor(editor, true, false)
  }

  async didInvokeFormatCommand(editor) {
    await this.formatEditor(editor, false, false)
  }

  async didInvokeFormatForcedCommand(editor) {
    try {
      const ready = await this.formatter.isReady
      if (!ready) return

      const issues = await this.formatter.formatEditorForced(editor)
      this.issueCollection.set(editor.document.uri, issues)
    } catch (err) {
      log.error(err, err.stack)
      showError(
        'prettier-format-error',
        nova.localize(
          'prettier.notification.format-error.title',
          'Error While Formatting',
          'notification',
        ),
        `"${err.message}"` +
          nova.localize(
            'prettier.notification.format-error.body',
            '\n\nSee the Extension Console for more info.',
            'notification',
          ),
      )
    }
  }

  async didInvokeFormatSelectionCommand(editor) {
    const supported = new Set([
      'javascript',
      'javascriptreact',
      'typescript',
      'typescriptreact',
      'graphql',
      'handlebars',
    ])

    const syntax = editor.document.syntax

    if (!supported.has(syntax)) {
      const suppressionKey = 'prettier.selection-unsupported.dismissed'
      const dismissed = nova.config.get(suppressionKey)
      if (dismissed === true) return

      let req = new NotificationRequest('prettier-selection-unsupported')
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

    await this.formatEditor(editor, false, true)
  }

  async didInvokeSaveWithoutFormattingCommand(editor) {
    this.ignoredEditors.add(editor)
    editor.save().finally(() => this.ignoredEditors.delete(editor))
  }

  async formatEditor(editor, isSaving, selectionOnly) {
    if (this.ignoredEditors.has(editor)) return

    try {
      const ready = await this.formatter.isReady
      if (!ready) return

      const issues = await this.formatter.formatEditor(
        editor,
        isSaving,
        selectionOnly,
      )
      this.issueCollection.set(editor.document.uri, issues)
    } catch (err) {
      log.error(err, err.stack)
      showError(
        'prettier-format-error',
        nova.localize(
          'prettier.notification.format-error.title',
          'Error While Formatting',
          'notification',
        ),
        `"${err.message}"` +
          nova.localize(
            'prettier.notification.format-error.body',
            '\n\nSee the Extension Console for more info.',
            'notification',
          ),
      )
    }
  }

  dispose() {
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

    // 6) clear debounce timer
    clearTimeout(this.nodeModulesChangeTimeout)
    this.nodeModulesChangeTimeout = null

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

    return showError(
      'prettier-resolution-error',
      nova.localize(
        'prettier.notification.prettier-start-failed.title',
        'Unable to Start Prettier',
        'notification',
      ),
      nova.localize(
        'prettier.notification.prettier-start-failed.body',
        'Please check the Extension Console for additional logs.',
        'notification',
      ),
    )
  }
}

exports.deactivate = function () {
  if (prettierExtensionInstance) {
    prettierExtensionInstance.dispose()
    prettierExtensionInstance = null
  }
}
