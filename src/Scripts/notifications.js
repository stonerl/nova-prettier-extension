/**
 * notifications.js — Central Nova Notification helper for Prettier⁺
 *
 * Exports:
 *   • showNotification(opts) — cancel & post a NotificationRequest;
 *     supports custom type, placeholder, default value, actions, callback, sound.
 *   • cancelNotification(id) — dismiss a pending notification by ID.
 *   • describeFailure(err) — short, user-facing reason for a failure.
 *   • withReason(body, reason) — append a failure reason to a body.
 *
 * Keeps all Nova notification boilerplate in one place.
 *
 * @license MIT
 * © 2025 Toni Förster
 */

const center = nova.notifications

/**
 * Show a notification.
 *
 * @param {Object}   opts
 * @param {string}   opts.id                      Unique identifier (will cancel any existing notification with this id).
 * @param {string}   opts.title                   Notification title.
 * @param {string}   opts.body                    Notification body text.
 * @param {string[]} [opts.actions]               Array of button labels.
 * @param {Function} [opts.callback]              Callback invoked with (actionIdx) after user interaction.
 * @returns {Promise<NotificationResponse|undefined>}
 *   Resolves with the NotificationResponse on success,
 *   or resolves to `undefined` if posting the notification fails (errors are logged).
 */
async function showNotification({ id, title, body, actions, callback }) {
  center.cancel(id)

  const req = new NotificationRequest(id)
  req.title = title
  req.body = body

  if (actions !== undefined) req.actions = actions

  try {
    const resp = await center.add(req)
    if (typeof callback === 'function') callback(resp?.actionIdx)
    return resp
  } catch (err) {
    console.error(err, err.stack)
  }
}

/**
 * Cancel (dismiss) a pending notification by its identifier.
 *
 * @param {string} id       Unique identifier of the notification to cancel.
 * @returns {void}
 */
function cancelNotification(id) {
  center.cancel(id)
}

const MAX_REASON_LENGTH = 200

/**
 * Shortens a path for display: relative to the workspace when inside it.
 *
 * @param {string} path
 * @returns {string}
 */
function displayPath(path) {
  const root = nova.workspace.path
  return root && path.startsWith(`${root}/`)
    ? path.slice(root.length + 1)
    : path
}

/**
 * Turns an error (or message) into a short, user-facing reason for a
 * notification. Known failure modes get a plain-language explanation;
 * anything else falls back to the first line of the message.
 *
 * @param {Error|string|null|undefined} err
 * @returns {string|null}  null when there is nothing useful to show
 */
function describeFailure(err) {
  if (!err) return null
  const message = String(err.message ?? err).trim()
  if (!message) return null

  const missingModule = message.match(/Cannot find module '([^']+)'/)
  if (missingModule) {
    return nova
      .localize(
        'prettier.notification.reason.module-not-found',
        'Prettier could not be loaded from {path}. The installation may be incomplete — try reinstalling your project’s dependencies.',
        'notification',
      )
      .replace('{path}', displayPath(missingModule[1]))
  }

  const timedOut = message.match(/(?:timed out after|within) (\d+)ms/)
  if (timedOut) {
    return nova
      .localize(
        'prettier.notification.reason.timed-out',
        'A Node.js process didn’t respond within {seconds} seconds. Your Mac may be under heavy load — try restarting Prettier once it settles.',
        'notification',
      )
      .replace('{seconds}', String(Math.round(Number(timedOut[1]) / 1000)))
  }

  const exitCode = message.match(/exited before starting \(exit code (-?\d+)\)/)
  if (exitCode) {
    return nova
      .localize(
        'prettier.notification.reason.exited',
        'The Prettier service exited during startup (exit code {code}).',
        'notification',
      )
      .replace('{code}', exitCode[1])
  }

  const firstLine = message.split('\n')[0].replace(/^Error:\s*/, '')
  return firstLine.length > MAX_REASON_LENGTH
    ? `${firstLine.slice(0, MAX_REASON_LENGTH - 1)}…`
    : firstLine
}

/**
 * Appends a failure reason to a notification body, leaving the body
 * unchanged when there is no reason.
 *
 * @param {string}      body
 * @param {string|null} reason
 * @returns {string}
 */
function withReason(body, reason) {
  if (!reason) return body
  const label = nova.localize(
    'prettier.notification.reason.label',
    'Reason:',
    'notification',
  )
  return `${body}\n\n${label} ${reason}`
}

module.exports = {
  showNotification,
  cancelNotification,
  describeFailure,
  withReason,
}
