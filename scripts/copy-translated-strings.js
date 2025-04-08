const fs = require('fs')
const path = require('path')

// Define project directories
const PROJECT_ROOT = path.resolve(__dirname, '..')
const TRANSLATIONS_DIR = path.join(PROJECT_ROOT, 'translations')
const EXTENSION_DIR = path.join(PROJECT_ROOT, 'prettier.novaextension')

// List of language folders you use for translations.
const languages = [
  'de.lproj',
  'en.lproj',
  'fr.lproj',
  'jp.lproj',
  'zh-Hans.lproj',
]

languages.forEach((lang) => {
  const sourceFile = path.join(TRANSLATIONS_DIR, lang, 'strings.json')

  // If there's no translation file for the language, skip it.
  if (!fs.existsSync(sourceFile)) {
    console.warn(
      `Source file for ${lang} not found at ${sourceFile}. Skipping.`,
    )
    return
  }

  // Read and parse the JSON file.
  let translations = {}
  try {
    translations = JSON.parse(fs.readFileSync(sourceFile, 'utf8'))
  } catch (err) {
    console.error(`Error parsing ${sourceFile}:`, err)
    return
  }

  // Filter out strings that are not translated (empty or whitespace only)
  const filtered = {}
  Object.keys(translations).forEach((key) => {
    const value = translations[key]
    if (typeof value === 'string' && value.trim().length > 0) {
      filtered[key] = value
    }
  })

  const filteredCount = Object.keys(filtered).length
  if (filteredCount === 0) {
    console.log(`No translated strings found for ${lang}. Nothing to copy.`)
    return
  }

  // Define the destination directory inside the extension folder,
  // mirroring the language folder structure.
  const destLangDir = path.join(EXTENSION_DIR, lang)
  fs.mkdirSync(destLangDir, { recursive: true })

  // Write the filtered translations into the destination file.
  const destFile = path.join(destLangDir, 'strings.json')
  fs.writeFileSync(destFile, JSON.stringify(filtered, null, 2))
  console.log(
    `Copied ${filteredCount} translated strings for ${lang} to ${destFile}`,
  )
})
