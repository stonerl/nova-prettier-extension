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

// Load unified configuration
const unifiedConfig = JSON.parse(
  fs.readFileSync('./src/unifiedConfig.json', 'utf8'),
)

// Function to extract specific configurations
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

// Generate configurations
const globalConfig = extractConfig(unifiedConfig, 'config')
const workspaceConfig = extractConfig(unifiedConfig, 'configWorkspace')

// Write the configurations to files
fs.writeFileSync(
  './prettier.novaextension/config.json',
  JSON.stringify(globalConfig, null, 2),
)
fs.writeFileSync(
  './prettier.novaextension/configWorkspace.json',
  JSON.stringify(workspaceConfig, null, 2),
)

// Minify JSON files
const minifyConfigFile = (filePath) => {
  if (!fs.existsSync(filePath)) {
    console.warn(`⚠️  Skipping missing file: ${filePath}`)
    return
  }

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    fs.writeFileSync(filePath, JSON.stringify(data))
  } catch (error) {
    console.warn(
      `⚠️  Failed to parse JSON in file: ${filePath}. Skipping. Error: ${error.message}`,
    )
  }
}

// List of JSON files to minify
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

// Minify all listed files
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
        format: {
          comments: false,
        },
      }),
    ],
  },
]
