/**
 * prune-runtime-deps.js — Post-install cleanup for bundled node_modules
 *
 * @license MIT
 * @author Toni Förster
 * @copyright © 2026 Toni Förster
 *
 * The bundled dependencies are installed at activation with
 * `npm install --omit=dev`, yet the packages still ship content the
 * extension runtime never reads: sourcemaps, TypeScript typings, docs,
 * and node-sql-parser's browser-only UMD and per-dialect builds. This
 * script deletes those files, roughly halving the bundle's disk
 * footprint.
 *
 * Keeps LICENSE/NOTICE/COPYING files — removing them would drop legally
 * required attribution. Idempotent: a pruned tree is left untouched and
 * reported silently, so repeated runs after crashes converge.
 *
 * Usage: node prune-runtime-deps.js [nodeModulesPath]
 */

const fs = require('fs')
const path = require('path')

const nodeModules = path.resolve(
  process.argv[2] ?? path.join(__dirname, '..', 'node_modules'),
)

const sqlParserDir = path.join(nodeModules, 'node-sql-parser')

const deadDirectories = [
  path.join(sqlParserDir, 'umd'),
  path.join(sqlParserDir, 'build'),
]

const legalNamePattern = /licen[cs]e|notice|third[-_]?party|copying|authors/i

let deletedFiles = 0
let deletedBytes = 0
let failedFiles = 0

function recordSize(filePath) {
  try {
    deletedFiles += 1
    deletedBytes += fs.statSync(filePath).size
  } catch {
    // vanished between listing and stat — nothing to record
  }
}

function deleteFile(filePath) {
  try {
    recordSize(filePath)
    fs.unlinkSync(filePath)
  } catch (error) {
    failedFiles += 1
    console.warn(`Could not delete ${filePath}: ${error.message}`)
  }
}

/**
 * Removes dead-weight files from a directory tree. Dirent types are read
 * without following symlinks, so npm's `.bin` links and workspace links
 * are left untouched.
 */
function pruneTree(directory) {
  let entries
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true })
  } catch (error) {
    console.warn(`Could not read ${directory}: ${error.message}`)
    return
  }

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      pruneTree(entryPath)
    } else if (entry.isFile()) {
      const name = entry.name.toLowerCase()

      if (
        name.endsWith('.map') ||
        name.endsWith('.d.ts') ||
        name.endsWith('.d.cts') ||
        name.endsWith('.d.mts')
      ) {
        deleteFile(entryPath)
      } else if (name.endsWith('.md') && !legalNamePattern.test(name)) {
        deleteFile(entryPath)
      }
    }
  }
}

function recordTreeSizes(directory) {
  let entries
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      recordTreeSizes(entryPath)
    } else if (entry.isFile()) {
      recordSize(entryPath)
    }
  }
}

function main() {
  if (!fs.existsSync(nodeModules)) {
    console.warn(`No node_modules found at ${nodeModules} — nothing to prune`)
    return
  }

  for (const directory of deadDirectories) {
    if (!fs.existsSync(directory)) continue

    recordTreeSizes(directory)
    try {
      fs.rmSync(directory, { recursive: true, force: true })
    } catch (error) {
      failedFiles += 1
      console.warn(`Could not delete ${directory}: ${error.message}`)
    }
  }

  pruneTree(nodeModules)

  if (deletedFiles === 0) return

  const megabytes = (deletedBytes / (1024 * 1024)).toFixed(1)
  console.log(
    `Pruned ${deletedFiles} files (${megabytes} MB) from bundled node_modules`,
  )
  if (failedFiles > 0) {
    process.exitCode = 1
  }
}

main()
