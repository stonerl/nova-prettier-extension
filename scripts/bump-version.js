const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const version = fs.readFileSync('.version', 'utf8').trim()
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('❌ Invalid version in .version file:', version)
  process.exit(1)
}

function bumpWithNpm(pkgPath) {
  const cwd = path.dirname(pkgPath)
  try {
    execSync(`npm version ${version} --no-git-tag-version`, {
      cwd,
      stdio: 'inherit',
    })
    console.log(`✔ Bumped version in ${pkgPath}`)
  } catch (err) {
    console.error(`❌ Failed to bump version in ${pkgPath}:`, err.message)
    process.exit(1)
  }
}

function bumpJsonFile(file) {
  const content = fs.readFileSync(file, 'utf8')
  const updated = content.replace(
    /("version"\s*:\s*")[^"]+(")/,
    `$1${version}$2`,
  )
  fs.writeFileSync(file, updated)
  console.log(`✔ Updated version in ${file} (preserved formatting)`)
}

function prependChangelogEntry(file) {
  const date = new Date().toISOString().split('T')[0] // e.g. "2025-04-13"
  const entry = `## ${version} - ${date}\n\n`

  const oldContent = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  const newContent = entry + oldContent

  fs.writeFileSync(file, newContent)
  console.log(`✔ Prepended changelog entry to ${file}`)
}

// 1. Bump both package.json files using npm
bumpWithNpm('package.json')
bumpWithNpm('prettier.novaextension/package.json')

// 2. Update extension.json directly
bumpJsonFile('prettier.novaextension/extension.json')

// 3. Add new version to CHANGELOG.md
prependChangelogEntry('prettier.novaextension/CHANGELOG.md')
