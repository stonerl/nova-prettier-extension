/**
 * format-feedback.js — Format-time user feedback for Prettier⁺ for Nova
 *
 * @license MIT
 * @author Toni Förster
 * @copyright © 2026 Toni Förster
 *
 * The user-facing notices a format run can produce, and the mapping of
 * Prettier errors onto Nova issues. All dedup state here is
 * session-scoped — notifications must not re-spam on every format.
 */

const { showNotification } = require('../notifications.js')

const { log } = require('../helpers.js')

// One-time-per-session notice that the user's own config file declares
// plugins which Prettier⁺ doesn't bundle and couldn't find in the
// project — formatting continues with the bundled equivalents.
let _configPluginsNoticeShown = false

// Custom config path covered by the last load-failure notice.
let _lastCustomConfigErrorPath = null

// Config-declared plugins already reported as crashed.
const _disabledPluginsNotified = new Set()

/**
 * One-time-per-session notice that the user's own config file declares
 * plugins which Prettier⁺ doesn't bundle and couldn't find in the
 * project — formatting continues with the bundled equivalents.
 */
function showConfigPluginsNotice(unresolvedPlugins, configFile) {
  if (_configPluginsNoticeShown) return
  _configPluginsNoticeShown = true

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
function showCustomConfigErrorNotice(configError) {
  log.error(
    `Error loading custom config file at "${configError.path}": ${configError.message}`,
  )

  if (_lastCustomConfigErrorPath === configError.path) return
  _lastCustomConfigErrorPath = configError.path

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
 * Clears the custom-config-error notice state when the config loads
 * successfully again — the next failing path shows the notice fresh.
 */
function clearCustomConfigErrorNotice() {
  _lastCustomConfigErrorPath = null
}

/**
 * One-time-per-plugin notice that a project plugin crashed while
 * formatting — the service retried without it.
 *
 * @param {string[]} disabledPlugins – declared specifiers of the plugins
 */
function showDisabledPluginsNotice(disabledPlugins) {
  const pending = disabledPlugins.filter(
    (name) => !_disabledPluginsNotified.has(name),
  )
  if (pending.length === 0) return

  for (const name of pending) _disabledPluginsNotified.add(name)

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
function notifyFileTooLarge(size) {
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
function notifySqlDialectMismatch(dialect, selected) {
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

/**
 * Map a failed format onto Nova issues, or surface a parser-missing
 * notice when the failure means "no parser for this file type".
 *
 * @param {Error} error – the rehydrated error from the service
 * @param {boolean} missingParser
 * @param {boolean} saving
 * @param {string} filePath
 * @returns {Array<Issue>}
 */
function prettierErrorToIssues(error, missingParser, saving, filePath) {
  // The service guarantees a string message in its envelopes, but guard
  // before touching it — a non-string message means nothing to map.
  if (typeof error?.message !== 'string') return []

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

  return issuesFromPrettierError(error)
}

function issuesFromPrettierError(error) {
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

module.exports = {
  clearCustomConfigErrorNotice,
  notifyFileTooLarge,
  notifySqlDialectMismatch,
  prettierErrorToIssues,
  showConfigPluginsNotice,
  showCustomConfigErrorNotice,
  showDisabledPluginsNotice,
}
