/**
 * notifications.js — Central Nova Notification helper for Prettier⁺
 *
 * Exports:
 *   • showNotification(opts) — cancel & post a NotificationRequest;
 *     supports custom type, placeholder, default value, actions, callback, sound.
 *   • cancelNotification(id) — dismiss a pending notification by ID.
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
 * @param {string}   [opts.type]                  "input" or "secure-input" to show a text field. Defaults to basic.
 * @param {string}   [opts.textInputPlaceholder]  Placeholder text for input notifications.
 * @param {string}   [opts.textInputValue]        Default value for input notifications.
 * @param {string[]} [opts.actions]               Array of button labels; defaults to ["OK"].
 * @param {Function} [opts.callback]              Callback invoked with (actionIdx, textInputValue) after user interaction.
 * @returns {Promise<NotificationResponse|undefined>}
 *   Resolves with the NotificationResponse on success,
 *   or resolves to `undefined` if posting the notification fails (errors are logged).
 */
async function showNotification({
  id,
  title,
  body,
  type,
  textInputPlaceholder,
  textInputValue,
  actions = [
    nova.localize('prettier.notification.actions.ok', 'OK', 'notification'),
  ],
  callback,
}) {
  // auto-cancels any existing notification with the same id
  center.cancel(id)

  const req = new NotificationRequest(id)
  req.title = title
  req.body = body

  if (type) req.type = type
  if (textInputPlaceholder) req.textInputPlaceholder = textInputPlaceholder
  if (typeof textInputValue !== 'undefined') req.textInputValue = textInputValue

  req.actions = actions

  try {
    const resp = await center.add(req)
    if (callback) callback(resp.actionIdx, resp.textInputValue)
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

module.exports = {
  showNotification,
  cancelNotification,
}
