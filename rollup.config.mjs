/**
 * rollup.config.js — Build script for Prettier⁺ Nova extension
 *
 * @license MIT
 * @author Alexander Weiss, Toni Förster
 * @copyright © 2023 Alexander Weiss, © 2025 Toni Förster
 *
 * Bundles and minifies extension scripts and configuration files,
 * transforming unified configuration into platform-specific formats.
 */

import commonjs from '@rollup/plugin-commonjs'
import resolve from '@rollup/plugin-node-resolve'
import terser from '@rollup/plugin-terser'
import fs from 'fs'

const unifiedConfig = JSON.parse(
  fs.readFileSync('./src/unifiedConfig.json', 'utf8'),
)

const extractConfig = (unifiedConfig, type) => {
  const extract = (item) => {
    const extracted = { ...item }
    delete extracted.config
    delete extracted.configWorkspace

    if (type === 'config' && item.config) {
      Object.assign(extracted, item.config)
    } else if (type === 'configWorkspace' && item.configWorkspace) {
      Object.assign(extracted, item.configWorkspace)
    }

    if (item.children) {
      extracted.children = item.children.map(extract)
    }

    return extracted
  }

  return unifiedConfig.map(extract)
}

// Workspace enum items whose first choice is [null, "Global Setting"] get a
// `resolve` command so Nova re-computes the pop-up choices when the pane is
// shown; the handler renames the first choice to "Global Setting (<value>)"
// with the preference's current value (see src/Scripts/settings.js). The
// static `values` stay in place as a fallback for older Nova versions.
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

const globalConfig = extractConfig(unifiedConfig, 'config')
const workspaceConfig = extractConfig(unifiedConfig, 'configWorkspace')

collectWorkspaceChoices(workspaceConfig)

fs.writeFileSync(
  './src/Scripts/workspace-choices.js',
  `/**
 * workspace-choices.js — Generated from src/unifiedConfig.json by rollup.config.mjs
 *
 * @license MIT
 * @author Alexander Weiss, Toni Förster
 * @copyright © 2023 Alexander Weiss, © 2025 Toni Förster
 *
 * Own choices for each workspace enum setting whose first choice is the
 * null-valued "Global Setting" fallback. Do not edit by hand.
 */

/** @type {Record<string, Array<[string|boolean, string]>>} */
const WORKSPACE_CHOICES = ${JSON.stringify(workspaceChoices, null, '\t')}

module.exports = { WORKSPACE_CHOICES }
`,
)

fs.writeFileSync(
  './prettier.novaextension/config.json',
  JSON.stringify(globalConfig, null, 2),
)
fs.writeFileSync(
  './prettier.novaextension/configWorkspace.json',
  JSON.stringify(workspaceConfig, null, 2),
)

const minifyConfigFile = (filePath) => {
  if (!fs.existsSync(filePath)) {
    console.warn(`Skipping missing file: ${filePath}`)
    return
  }

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    fs.writeFileSync(filePath, JSON.stringify(data))
  } catch (error) {
    console.warn(
      `Failed to parse JSON in file: ${filePath}. Skipping. Error: ${error.message}`,
    )
  }
}

const jsonFilesToMinify = [
  'config.json',
  'configWorkspace.json',
  'de.lproj/notification.json',
  'de.lproj/strings.json',
  'en.lproj/notification.json',
  'en.lproj/strings.json',
  'fr.lproj/notification.json',
  'fr.lproj/strings.json',
  'jp.lproj/notification.json',
  'jp.lproj/strings.json',
  'zh-Hans.lproj/notification.json',
  'zh-Hans.lproj/strings.json',
].map((file) => `./prettier.novaextension/${file}`)

jsonFilesToMinify.forEach(minifyConfigFile)

export default [
  {
    input: './src/Scripts/main.js',
    output: {
      file: './prettier.novaextension/Scripts/main.js',
      format: 'cjs',
    },
    plugins: [
      commonjs(),
      resolve({ preferBuiltins: true }),
      terser({
        compress: {
          passes: 2,
        },
        format: {
          comments: false,
        },
      }),
    ],
  },
  {
    input: './src/Scripts/prettier-service/prettier-service.js',
    output: {
      file: './prettier.novaextension/Scripts/prettier-service/prettier-service.js',
      format: 'cjs',
    },
    plugins: [
      terser({
        compress: {
          passes: 2,
        },
        format: {
          comments: false,
        },
      }),
    ],
  },
  {
    input: './src/Scripts/prettier-service/json-rpc.js',
    output: {
      file: './prettier.novaextension/Scripts/prettier-service/json-rpc.js',
      format: 'cjs',
    },
    plugins: [
      terser({
        compress: {
          passes: 2,
        },
        format: {
          comments: false,
        },
      }),
    ],
  },
  {
    input: './src/Scripts/prune-runtime-deps.js',
    output: {
      file: './prettier.novaextension/Scripts/prune-runtime-deps.js',
      format: 'cjs',
    },
    plugins: [
      terser({
        compress: {
          passes: 2,
        },
        format: {
          comments: false,
        },
      }),
    ],
  },
]
