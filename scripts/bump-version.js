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

// 1. Bump both package.json files using npm
bumpWithNpm('package.json')
bumpWithNpm('prettier.novaextension/package.json')

// 2. Update extension.json directly
bumpJsonFile('prettier.novaextension/extension.json')
