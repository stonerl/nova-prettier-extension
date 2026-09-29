/**
 * settings.js — Project Settings "Global Setting" choice labels
 *
 * @license MIT
 * @author Toni Förster
 * @copyright © 2026 Toni Förster
 *
 * Workspace pop-up menus declare `resolve: "<key>.choices"`; Nova invokes
 * that command when the pane is shown, so the "Global Setting" choice can
 * name the preference's current value, e.g. "Global Setting (Enabled)".
 */

const { WORKSPACE_CHOICES } = require('./workspace-choices.js')

const USE_GLOBAL = 'Global Setting'

/**
 * A Project Settings pop-up's choices: "Global Setting" — naming the current
 * preference, e.g. "Global Setting (Enabled)" — followed by the setting's own
 * choices. The null value stores "follow the global preference".
 *
 * @param {string} key   — workspace configuration key
 * @param {unknown} globalValue — value of the global preference (nova.config)
 * @param {((key: string, fallback: string) => string) | null} [localize] —
 *        label lookup; null means identity (testing)
 * @returns {Array<[unknown, string]>} enum values, same shape as `values`
 */
function projectChoices(key, globalValue, localize) {
  const lookup = localize || ((_, fallback) => fallback)
  const own = WORKSPACE_CHOICES[key] || []
  const prefix = lookup(USE_GLOBAL, USE_GLOBAL)
  const current = own.find(([value]) => value === globalValue)

  const inheritedLabel = current
    ? `${prefix} (${lookup(current[1], current[1])})`
    : prefix

  return [
    [null, inheritedLabel],
    ...own.map(([value, label]) => [value, lookup(label, label)]),
  ]
}

const resolveCommand = (key) => `${key}.choices`

module.exports = { USE_GLOBAL, projectChoices, resolveCommand }
