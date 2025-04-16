/**
 * extract-strings.js — Extracts translatable strings from config and extension metadata
 *
 * @license MIT
 * @author Toni Förster
 * @copyright © 2025 Toni Förster
 *
 * Scans unified configuration and extension metadata as well as source files for
 * all user-visible strings for translation. Merges with existing entries per language.
 *
 * Uses key/table approach so that calls like:
 *
 *   nova.localize('prettier.notification.config.updated.title', 'Project Configuration Updated', 'notification')
 *
 * will be stored in "notification.json", while others go into "strings.json".
 */

const fs = require('fs')
const path = require('path')

// Project root directory
const PROJECT_ROOT = path.resolve(__dirname, '..')
const TRANSLATIONS_DIR = path.join(PROJECT_ROOT, 'translations')
const SCRIPTS_DIR = path.join(PROJECT_ROOT, 'src', 'Scripts')

const unifiedConfigPath = path.join(PROJECT_ROOT, 'src/unifiedConfig.json')
const extensionJsonPath = path.join(
  PROJECT_ROOT,
  'prettier.novaextension/extension.json',
)

// Languages to output translations for
const languages = [
  'de.lproj',
  'en.lproj',
  'fr.lproj',
  'jp.lproj',
  'zh-Hans.lproj',
]

// Global results object, keyed by table name.
// Any extraction without a specified table goes to the default "strings" table.
const results = {
  strings: {},
}

// ─────────────────────────────────────────
// Extraction from unifiedConfig.json
if (fs.existsSync(unifiedConfigPath)) {
  const unifiedConfig = JSON.parse(fs.readFileSync(unifiedConfigPath, 'utf8'))

  function extractTranslatableValues(config, configWorkspace) {
    if (!Array.isArray(configWorkspace?.values)) return

    const workspaceValues = configWorkspace.values
    const baseValues = new Set(
      Array.isArray(config?.values)
        ? config.values.map((v) => (Array.isArray(v) ? v[0] : v))
        : [],
    )

    for (const item of workspaceValues) {
      const key = Array.isArray(item) ? item[0] : item
      const label = Array.isArray(item) ? item[1] : item

      if (!baseValues.has(key)) {
        results.strings[label] = label
      } else {
        console.log(`🔁 Skipping "${label}"`)
      }
    }
  }

  function extractFromUnified(nodes) {
    for (const node of nodes) {
      if (node.title) results.strings[node.title] = node.title
      if (node.description) results.strings[node.description] = node.description
      if (node.placeholder) results.strings[node.placeholder] = node.placeholder

      if (node.config?.title)
        results.strings[node.config.title] = node.config.title
      if (node.config?.description)
        results.strings[node.config.description] = node.config.description
      if (node.config?.placeholder)
        results.strings[node.config.placeholder] = node.config.placeholder

      if (node.configWorkspace?.title)
        results.strings[node.configWorkspace.title] = node.configWorkspace.title
      if (node.configWorkspace?.description)
        results.strings[node.configWorkspace.description] =
          node.configWorkspace.description
      if (node.configWorkspace?.placeholder)
        results.strings[node.configWorkspace.placeholder] =
          node.configWorkspace.placeholder

      extractTranslatableValues(node.config, node.configWorkspace)

      // Extract second element from any tuple in "values" array in config
      if (node.config?.values && Array.isArray(node.config.values)) {
        for (const tuple of node.config.values) {
          if (Array.isArray(tuple) && tuple.length > 1 && tuple[1])
            results.strings[tuple[1]] = tuple[1]
        }
      }

      // Extract second element from any tuple in "values" array in configWorkspace
      if (
        node.configWorkspace?.values &&
        Array.isArray(node.configWorkspace.values)
      ) {
        for (const tuple of node.configWorkspace.values) {
          if (Array.isArray(tuple) && tuple.length > 1 && tuple[1])
            results.strings[tuple[1]] = tuple[1]
        }
      }

      if (Array.isArray(node.children)) extractFromUnified(node.children)
    }
  }

  extractFromUnified(unifiedConfig)
}

// ─────────────────────────────────────────
// Extraction from extension.json
if (fs.existsSync(extensionJsonPath)) {
  const ext = JSON.parse(fs.readFileSync(extensionJsonPath, 'utf8'))

  // Extract root-level keys
  if (ext.description) results.strings[ext.description] = ext.description

  const commandSections = ext.commands || {}
  for (const section of Object.values(commandSections)) {
    for (const cmd of section) {
      if (cmd.title) results.strings[cmd.title] = cmd.title
      if (cmd.description) results.strings[cmd.description] = cmd.description
    }
  }
}

// ─────────────────────────────────────────
// Extract nova.localize() strings from src/Scripts using AST
const parser = require('@babel/parser')
const traverse = require('@babel/traverse').default

function extractNotificationKeysAST(filePath) {
  const code = fs.readFileSync(filePath, 'utf8')
  const ast = parser.parse(code, {
    sourceType: 'module',
    // Add plugins as needed (e.g. 'jsx', 'typescript')
    plugins: ['jsx', 'typescript'],
  })

  traverse(ast, {
    CallExpression({ node }) {
      // Check if the call is nova.localize(...)
      if (
        node.callee &&
        node.callee.type === 'MemberExpression' &&
        node.callee.object.name === 'nova' &&
        node.callee.property.name === 'localize'
      ) {
        const args = node.arguments
        // Ensure we have at least 2 arguments (key and fallback)
        if (
          args.length >= 2 &&
          args[0].type === 'StringLiteral' &&
          args[1].type === 'StringLiteral'
        ) {
          const key = args[0].value
          const fallback = args[1].value
          // Default table is "strings"
          let tableName = 'strings'
          // If a third argument is provided and is a string literal, use that as the table name
          if (
            args.length >= 3 &&
            args[2].type === 'StringLiteral' &&
            args[2].value
          ) {
            tableName = args[2].value
          }
          // Ensure the table exists in our results object
          if (!results[tableName]) {
            results[tableName] = {}
          }
          results[tableName][key] = fallback

          console.log(
            `Extracted key "${key}" with fallback "${fallback}" into table "${tableName}"`,
          )
        }
      }
    },
  })
}

function extractNotificationKeysFromDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      extractNotificationKeysFromDir(fullPath)
    } else if (
      entry.isFile() &&
      (fullPath.endsWith('.js') ||
        fullPath.endsWith('.jsx') ||
        fullPath.endsWith('.ts'))
    ) {
      extractNotificationKeysAST(fullPath)
    }
  }
}

if (fs.existsSync(SCRIPTS_DIR)) {
  extractNotificationKeysFromDir(SCRIPTS_DIR)
}

// ─────────────────────────────────────────
// Write out translations to separate files per table (e.g. strings.json, notification.json)
// For each language, create a separate JSON file for each table in results.
languages.forEach((lang) => {
  const langDir = path.join(TRANSLATIONS_DIR, lang)
  fs.mkdirSync(langDir, { recursive: true })

  for (const tableName in results) {
    const outputPath = path.join(langDir, tableName + '.json')

    let existing = {}
    if (fs.existsSync(outputPath)) {
      try {
        existing = JSON.parse(fs.readFileSync(outputPath, 'utf8'))
      } catch (e) {
        console.warn(
          `⚠️ Could not parse ${lang}/${tableName}.json — skipping merge`,
        )
      }
    }

    const merged = Object.fromEntries(
      Object.keys(results[tableName]).map((key) => [
        key,
        lang === 'en.lproj'
          ? results[tableName][key] // Always use updated fallback
          : (existing[key] ?? ''), // Use existing or empty string for others
      ]),
    )

    fs.writeFileSync(outputPath, JSON.stringify(merged, null, 2) + '\n')
    console.log(
      `✅ Wrote ${Object.keys(merged).length} strings to translations/${lang}/${tableName}.json`,
    )
  }
})
