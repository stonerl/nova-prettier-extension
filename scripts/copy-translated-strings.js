/**
 * copy-translated-strings.js — Copies filtered translations into the extension
 *
 * @license MIT
 * @author Toni Förster
 * @copyright © 2025 Toni Förster
 *
 * For strings.json, only valid, non-empty entries are copied into the extension’s
 * language folders using filtering logic.
 *
 * For notification.json, the file is simply copied as is, since those strings are used
 * for web-based late translations.
 */

const fs = require('fs')
const path = require('path')

// Define project directories
const PROJECT_ROOT = path.resolve(__dirname, '..')
const TRANSLATIONS_DIR = path.join(PROJECT_ROOT, 'translations')
const EXTENSION_DIR = path.join(PROJECT_ROOT, 'prettier.novaextension')

const languages = [
  'de.lproj',
  'en.lproj',
  'fr.lproj',
  'jp.lproj',
  'zh-Hans.lproj',
]

// strings.json — copy with filtering
languages.forEach((lang) => {
  const sourceFile = path.join(TRANSLATIONS_DIR, lang, 'strings.json')

  if (!fs.existsSync(sourceFile)) {
    console.warn(
      `Source file for ${lang} not found at ${sourceFile}. Skipping strings.json.`,
    )
    return
  }

  let translations = {}
  try {
    translations = JSON.parse(fs.readFileSync(sourceFile, 'utf8'))
  } catch (err) {
    console.error(`Error parsing ${sourceFile}:`, err)
    return
  }

  // drop empty or whitespace-only entries
  const filtered = {}
  Object.keys(translations).forEach((key) => {
    const value = translations[key]
    if (typeof value === 'string' && value.trim().length > 0) {
      filtered[key] = value
    }
  })

  const filteredCount = Object.keys(filtered).length
  if (filteredCount === 0) {
    console.log(
      `No translated strings found for ${lang} in strings.json. Nothing to copy.`,
    )
    return
  }

  const destLangDir = path.join(EXTENSION_DIR, lang)
  fs.mkdirSync(destLangDir, { recursive: true })

  const destFile = path.join(destLangDir, 'strings.json')
  fs.writeFileSync(destFile, JSON.stringify(filtered, null, 2))
  console.log(
    `Copied ${filteredCount} translated strings for ${lang} to ${destFile}`,
  )
})

// notification.json — copy as is (used for web-based late translations)
languages.forEach((lang) => {
  const sourceFile = path.join(TRANSLATIONS_DIR, lang, 'notification.json')

  if (!fs.existsSync(sourceFile)) {
    console.warn(
      `Source file for ${lang} not found at ${sourceFile}. Skipping notification.json.`,
    )
    return
  }

  let contents = ''
  try {
    contents = fs.readFileSync(sourceFile, 'utf8')
  } catch (err) {
    console.error(`Error reading ${sourceFile}:`, err)
    return
  }

  const destLangDir = path.join(EXTENSION_DIR, lang)
  fs.mkdirSync(destLangDir, { recursive: true })

  const destFile = path.join(destLangDir, 'notification.json')
  fs.writeFileSync(destFile, contents)
  console.log(`Copied notification strings for ${lang} to ${destFile}`)
})
