/**
 * workspace-choices.test.js — Choices for Project Settings pop-ups that
 * fall back to the global preference
 *
 * @license MIT
 * @author Toni Förster
 * @copyright © 2026 Toni Förster
 *
 * Plain Node script — no test framework. Exits non-zero on failure.
 *
 * Workspace enums declare `resolve: "<key>.choices"`; Nova re-requests the
 * choices each time Project Settings is shown. The generated
 * workspace-choices.js must list exactly the setting's own choices from
 * the built manifest (dropping the null-valued "Global Setting" fallback),
 * and projectChoices() must rename that fallback with the global value,
 * e.g. "Global Setting (Enabled)" — or plain "Global Setting" when the
 * preference is unset or holds a value that isn't one of the choices.
 */

const path = require('path')
const fs = require('fs')

const ROOT = path.join(__dirname, '..')

let failed = 0
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`)
  if (!ok) {
    failed++
    if (detail !== undefined) {
      console.log(` → ${JSON.stringify(detail, null, 2).slice(0, 800)}`)
    }
  }
}

const settingsSrc = fs.readFileSync(
  path.join(ROOT, 'src', 'Scripts', 'settings.js'),
  'utf8',
)

// Loads settings.js with an injectable choice table (so tests don't
// depend on the real table's keys). Requires a build to have produced
// workspace-choices.js first (npm run test:setup).
function loadSettings(table) {
  const { WORKSPACE_CHOICES } = require(
    path.join(ROOT, 'src', 'Scripts', 'workspace-choices.js'),
  )
  const module = { exports: {} }
  const factory = new Function(
    'module',
    'exports',
    'WORKSPACE_CHOICES_INJECTED',
    settingsSrc.replace(
      "const { WORKSPACE_CHOICES } = require('./workspace-choices.js')",
      'const WORKSPACE_CHOICES = WORKSPACE_CHOICES_INJECTED',
    ),
  )
  factory(module, module.exports, table || WORKSPACE_CHOICES)
  return module.exports
}

// --- projectChoices() ---

const OWN = [
  [true, 'Enabled'],
  [false, 'Disabled'],
]
const { projectChoices, resolveCommand, USE_GLOBAL } = loadSettings({
  'test.one': OWN,
})

let result = projectChoices('test.one', true)
check(
  'global true → "Global Setting (Enabled)"',
  result[0][0] === null && result[0][1] === 'Global Setting (Enabled)',
  result[0],
)

result = projectChoices('test.one', false)
check(
  'global false → "Global Setting (Disabled)"',
  result[0][1] === 'Global Setting (Disabled)',
  result[0],
)

result = projectChoices('test.one', undefined)
check(
  'global unset → plain "Global Setting"',
  result[0][1] === 'Global Setting',
  result[0],
)

result = projectChoices('test.one', null)
check(
  'global null → plain "Global Setting" (not "null")',
  result[0][1] === 'Global Setting',
  result[0],
)

result = projectChoices('test.one', 'wildcard')
check(
  'global value outside choices → plain "Global Setting"',
  result[0][1] === 'Global Setting',
  result[0],
)

check(
  'strict identity match (string "true" is not boolean true)',
  projectChoices('test.one', 'true')[0][1] === 'Global Setting',
)

result = projectChoices('missing.key', true)
check(
  'unknown key → single "Global Setting" entry',
  JSON.stringify(result) === JSON.stringify([[null, 'Global Setting']]),
  result,
)

result = projectChoices('test.one', true)
check(
  'own choices appended verbatim',
  JSON.stringify(result.slice(1)) === JSON.stringify(OWN),
  result,
)

const localized = projectChoices('test.one', true, (key, fallback) =>
  key === 'Enabled' ? 'Aktiviert' : fallback,
)
check(
  'localize lookup applied to prefix and labels',
  JSON.stringify(localized) ===
    JSON.stringify([
      [null, 'Global Setting (Aktiviert)'],
      [true, 'Aktiviert'],
      [false, 'Disabled'],
    ]),
  localized,
)

const identityLocalized = projectChoices('test.one', true, null)
check(
  'null localize falls back to identity',
  JSON.stringify(identityLocalized) === JSON.stringify(result),
)

check(
  'resolveCommand appends .choices',
  resolveCommand('prettier.format-on-save') ===
    'prettier.format-on-save.choices',
)

check('USE_GLOBAL is "Global Setting"', USE_GLOBAL === 'Global Setting')

// --- manifest ↔ generated table consistency ---

const built = require(
  path.join(ROOT, 'prettier.novaextension', 'configWorkspace.json'),
)
const { WORKSPACE_CHOICES } = require(
  path.join(ROOT, 'src', 'Scripts', 'workspace-choices.js'),
)

const flat = []
const walk = (items) =>
  items.forEach((item) =>
    item.children ? walk(item.children) : flat.push(item),
  )
walk(built)

const enums = flat.filter(
  (item) =>
    Array.isArray(item.values) && item.values[0][0] === null && item.key,
)
const tableKeys = Object.keys(WORKSPACE_CHOICES)
const enumKeys = enums.map((item) => item.key)

check(
  'table covers exactly the null-first workspace enums',
  enumKeys.length === tableKeys.length &&
    enumKeys.every((key) => tableKeys.includes(key)),
  {
    enums: enumKeys.length,
    table: tableKeys.length,
    missing: enumKeys.filter((key) => !tableKeys.includes(key)),
    orphan: tableKeys.filter((key) => !enumKeys.includes(key)),
  },
)

check(
  'table entries equal the manifest values sans fallback',
  enums.every(
    (item) =>
      JSON.stringify(WORKSPACE_CHOICES[item.key]) ===
      JSON.stringify(item.values.slice(1)),
  ),
)

check(
  'every manifest enum resolves to <key>.choices',
  enums.every((item) => item.resolve === `${item.key}.choices`),
)

// --- end to end with the real generated table ---

const { projectChoices: realProjectChoices } = loadSettings()

const real = realProjectChoices(
  'prettier.module.preferBundled',
  true,
  (key, fallback) => (key === 'Enabled' ? 'Aktiviert' : fallback),
)
check(
  'real table: preferBundled global true → localized label composed',
  JSON.stringify(real) ===
    JSON.stringify([
      [null, 'Global Setting (Aktiviert)'],
      [true, 'Aktiviert'],
      [false, 'Disabled'],
    ]),
  real,
)

const realString = realProjectChoices(
  'prettier.default-config.trailingComma',
  'all',
)
check(
  'real table: trailingComma global "all" → raw label in parens',
  realString[0][0] === null && realString[0][1] === 'Global Setting (all)',
  realString,
)

process.exit(failed === 0 ? 0 : 1)
