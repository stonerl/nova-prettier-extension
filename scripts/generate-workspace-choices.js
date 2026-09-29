/**
 * generate-workspace-choices.js — Generates workspace-choices.js from unifiedConfig.json
 *
 * @license MIT
 * @author Toni Förster
 * @copyright © 2025 Toni Förster
 *
 * Workspace enum items whose first choice is [null, "Global Setting"] get a
 * `resolve` command in the built configWorkspace.json so Nova re-computes the
 * pop-up choices when the pane is shown; the handler renames the first choice
 * to "Global Setting (<value>)" with the preference's current value (see
 * src/Scripts/settings.js). The static `values` stay in place as a fallback
 * for older Nova versions.
 *
 * This script writes that couple, kept in one place:
 *
 *   - injects `resolve` into src/unifiedConfig.json's workspace pass and
 *     writes it into prettier.novaextension/configWorkspace.json
 *   - writes each setting's own choices (values minus the fallback) into
 *     src/Scripts/workspace-choices.js, formatted with the project's
 *     .prettierrc so `prettier --check` (CI) passes after every build
 *
 * Run standalone via `npm run generate:workspace-choices`; npm run build
 * invokes it before rollup so bundling always sees a current table.
 */

const fs = require('fs')
const path = require('path')
const prettier = require('prettier')

const PROJECT_ROOT = path.resolve(__dirname, '..')
const UNIFIED_CONFIG = path.join(PROJECT_ROOT, 'src', 'unifiedConfig.json')
const MANIFEST_OUT = path.join(
  PROJECT_ROOT,
  'prettier.novaextension',
  'configWorkspace.json',
)
const CHOICES_OUT = path.join(
  PROJECT_ROOT,
  'src',
  'Scripts',
  'workspace-choices.js',
)

const unifiedConfig = JSON.parse(fs.readFileSync(UNIFIED_CONFIG, 'utf8'))

const extract = (item) => {
  const extracted = { ...item }
  delete extracted.config
  delete extracted.configWorkspace

  if (item.configWorkspace) {
    Object.assign(extracted, item.configWorkspace)
  }

  if (item.children) {
    extracted.children = item.children.map(extract)
  }

  return extracted
}

const workspaceChoices = {}

const collectWorkspaceChoices = (items) => {
  for (const item of items) {
    if (item.children) {
      collectWorkspaceChoices(item.children)
    } else if (
      Array.isArray(item.values) &&
      item.values[0]?.[0] === null &&
      item.key
    ) {
      item.resolve = `${item.key}.choices`
      workspaceChoices[item.key] = item.values.slice(1)
    }
  }
}

const workspaceConfig = unifiedConfig.map(extract)

collectWorkspaceChoices(workspaceConfig)

const generate = async () => {
  fs.writeFileSync(MANIFEST_OUT, JSON.stringify(workspaceConfig, null, 2))

  const choicesModule = `/**
 * workspace-choices.js — Generated from src/unifiedConfig.json by scripts/generate-workspace-choices.js
 *
 * @license MIT
 * @author Toni Förster
 * @copyright © 2026 Toni Förster
 *
 * Own choices for each workspace enum setting whose first choice is the
 * null-valued "Global Setting" fallback. Do not edit by hand.
 */

/** @type {Record<string, Array<[string|boolean, string]>>} */
const WORKSPACE_CHOICES = ${JSON.stringify(workspaceChoices)}

module.exports = { WORKSPACE_CHOICES }
`

  // Format with the project's .prettierrc so `prettier --check` (CI) passes
  // without a manual --write after every build. Config is resolved
  // explicitly — filepath alone doesn't reliably discover the rc file.
  fs.writeFileSync(
    CHOICES_OUT,
    await prettier.format(choicesModule, {
      ...(await prettier.resolveConfig(CHOICES_OUT)),
      filepath: CHOICES_OUT,
    }),
  )
}

generate()
