const fs = require('fs')
const path = require('path')

// Project root directory
const PROJECT_ROOT = path.resolve(__dirname, '..')
const TRANSLATIONS_DIR = path.join(PROJECT_ROOT, 'translations')

const unifiedConfigPath = path.join(PROJECT_ROOT, 'src/unifiedConfig.json')
const extensionJsonPath = path.join(
  PROJECT_ROOT,
  'prettier.novaextension/extension.json',
)

const languages = [
  'de.lproj',
  'en.lproj',
  'fr.lproj',
  'jp.lproj',
  'zh-Hans.lproj',
]

const result = {}

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
      result[label] = label
    } else {
      console.log(`🔁 Skipping "${label}"`)
    }
  }
}

// ─────────────────────────────────────────
// Parse unifiedConfig.json
if (fs.existsSync(unifiedConfigPath)) {
  const unifiedConfig = JSON.parse(fs.readFileSync(unifiedConfigPath, 'utf8'))

  function extractFromUnified(nodes) {
    for (const node of nodes) {
      if (node.title) result[node.title] = node.title
      if (node.description) result[node.description] = node.description

      if (node.config?.title) result[node.config.title] = node.config.title
      if (node.config?.description)
        result[node.config.description] = node.config.description

      if (node.configWorkspace?.title)
        result[node.configWorkspace.title] = node.configWorkspace.title
      if (node.configWorkspace?.description)
        result[node.configWorkspace.description] =
          node.configWorkspace.description

      extractTranslatableValues(node.config, node.configWorkspace)

      if (Array.isArray(node.children)) extractFromUnified(node.children)
    }
  }

  extractFromUnified(unifiedConfig)
}

// ─────────────────────────────────────────
// Parse extension.json
if (fs.existsSync(extensionJsonPath)) {
  const ext = JSON.parse(fs.readFileSync(extensionJsonPath, 'utf8'))

  const commandSections = ext.commands || {}
  for (const section of Object.values(commandSections)) {
    for (const cmd of section) {
      if (cmd.title) result[cmd.title] = cmd.title
      if (cmd.description) result[cmd.description] = cmd.description
    }
  }
}

// ─────────────────────────────────────────
// Write to each language's strings.json in /translations
languages.forEach((lang) => {
  const langDir = path.join(TRANSLATIONS_DIR, lang)
  const outputPath = path.join(langDir, 'strings.json')

  fs.mkdirSync(langDir, { recursive: true })

  let existing = {}
  if (fs.existsSync(outputPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(outputPath, 'utf8'))
    } catch (e) {
      console.warn(`⚠️ Could not parse ${lang}/strings.json — skipping merge`)
    }
  }

  const merged = Object.fromEntries(
    Object.keys(result).map((key) => [
      key,
      existing[key] ?? (lang === 'en.lproj' ? result[key] : ''),
    ]),
  )

  fs.writeFileSync(outputPath, JSON.stringify(merged, null, 2))
  console.log(
    `✅ Wrote ${Object.keys(merged).length} strings to translations/${lang}/strings.json`,
  )
})
