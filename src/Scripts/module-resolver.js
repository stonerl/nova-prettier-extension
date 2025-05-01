/**
 * module-resolver.js — Module resolution logic for Prettier⁺
 *
 * @license MIT
 * @author Alexander Weiss, Toni Förster
 * @copyright © 2023 Alexander Weiss, © 2025 Toni Förster
 *
 * Detects Prettier installations via filesystem and npm, falling back to bundled modules when necessary.
 */

const {
  getConfigWithWorkspaceOverride,
  getNodeVersion,
  getNpmVersion,
  handleProcessResult,
  log,
  showError,
} = require('./helpers.js')

function findPathRecursively(directory, subPath, callback) {
  while (true) {
    const path = nova.path.join(directory, subPath)
    const stats = nova.fs.stat(path)
    if (stats) {
      const result = callback(path, stats)
      if (result) return { directory, path }
    }

    if (directory === '/') break
    directory = nova.path.dirname(directory)
  }

  return null
}

function findModuleWithFileSystem(directory, module) {
  // Find the first parent folder with package.json that contains prettier
  const packageResult = findPathRecursively(
    directory,
    'package.json',
    (path, stats) => {
      if (!stats.isFile()) return false

      const file = nova.fs.open(path, 'r')
      try {
        const json = JSON.parse(file.read())
        if (
          (json.dependencies && json.dependencies[module]) ||
          (json.devDependencies && json.devDependencies[module])
        ) {
          return true
        }
      } catch {}
    },
  )
  if (!packageResult) return null

  // In that folder, or a parent, find node_modules/[module]
  const moduleResult = findPathRecursively(
    packageResult.directory,
    nova.path.join('node_modules', module),
    (path, stats) => stats.isDirectory() || stats.isSymbolicLink(),
  )

  return moduleResult ? moduleResult.path : null
}

async function findModuleWithNPM(directory, module) {
  let resolve, reject
  const promise = new Promise((_resolve, _reject) => {
    resolve = _resolve
    reject = _reject
  })

  const process = new Process('/usr/bin/env', {
    args: [
      'npm',
      'ls',
      String(module),
      '--parseable',
      '--long',
      '--depth',
      '0',
    ],
    cwd: directory,
  })

  process.onStdout((result) => {
    if (!result || !result.trim()) return

    const [path, name, status, extra] = result.trim().split(':')
    if (!name || !name.startsWith(`${module}@`)) return resolve(null)
    if (path === nova.workspace.path) {
      log.info(
        `You seem to be working on ${module}! The extension doesn’t work without ${module} built, so using the built-in ${module} instead.`,
      )
      return resolve(null)
    }

    resolve({
      path,
      correctVersion: status !== 'INVALID' && extra !== 'MAXDEPTH',
    })
  })

  handleProcessResult(process, reject, resolve)
  process.start()

  return promise
}

async function installPackages(directory) {
  let resolve, reject
  const promise = new Promise((_resolve, _reject) => {
    resolve = _resolve
    reject = _reject
  })

  const process = new Process('/usr/bin/env', {
    args: ['npm', 'install', '--only-prod'],
    cwd: directory,
  })

  handleProcessResult(process, reject, resolve)
  process.start()

  return promise
}

module.exports = async function () {
  const nodeVersion = await getNodeVersion()
  const npmVersion = await getNpmVersion()

  // If either npm or Node isn’t detected, error out immediately
  if (npmVersion === 'unknown' || nodeVersion === 'unknown') {
    showError(
      'prettier-resolution-error',
      nova.localize(
        'prettier.notification.runtimeMissing.title',
        'Missing Runtime Tools',
        'notification',
      ),
      nova.localize(
        'prettier.notification.runtimeMissing.body',
        'Please install Node.js (which includes npm) and ensure it’s on your PATH so Prettier⁺ can resolve correctly. Then restart Nova to apply the change.',
        'notification',
      ),
    )
    // stop execution — we can’t proceed without both binaries
    throw new Error('Missing runtime tools: Node.js and npm are required.')
  }

  log.debug(`node Version: ${nodeVersion}\nnpm Version: ${npmVersion}`)

  const preferBundled = getConfigWithWorkspaceOverride(
    'prettier.module.preferBundled',
  )

  // Try finding in the workspace
  if (nova.workspace.path && !preferBundled) {
    // Try finding purely through file system first
    try {
      const fsResult = findModuleWithFileSystem(nova.workspace.path, 'prettier')
      if (fsResult) {
        log.info(`Loading project prettier (fs) at ${fsResult}`)
        return fsResult
      }
    } catch (err) {
      log.warn(
        'Error trying to find workspace Prettier using file system',
        err,
        err.stack,
      )
    }

    // Try npm as an alternative
    try {
      const npmResult = await findModuleWithNPM(nova.workspace.path, 'prettier')
      if (npmResult) {
        log.info(`Loading project prettier (npm) at ${npmResult.path}`)
        return npmResult.path
      }
    } catch (err) {
      if (err.status === 127) throw err
      log.warn(
        'Error trying to find workspace Prettier using npm',
        err,
        err.stack,
      )
    }
  }

  // Install/update bundled modules
  try {
    const prettierPath = nova.path.join(
      nova.extension.path,
      'node_modules',
      'prettier',
    )
    const nodeModulesExists = !!nova.fs.stat(
      nova.path.join(nova.extension.path, 'node_modules'),
    )
    const lockfileExists = !!nova.fs.stat(
      nova.path.join(nova.extension.path, 'package-lock.json'),
    )

    let installReason = null

    if (!nodeModulesExists || !lockfileExists) {
      installReason = 'missing dependencies'
    }

    let declaredPackages = {}

    try {
      const packageJsonPath = nova.path.join(
        nova.extension.path,
        'package.json',
      )

      try {
        const file = nova.fs.open(packageJsonPath, 'r') // Open the file for reading
        const packageJsonContent = file.read() // Read the content into a string

        const json = JSON.parse(packageJsonContent) // Parse the JSON string

        declaredPackages = {
          ...(json.dependencies || {}),
          ...(json.optionalDependencies || {}),
        }
      } catch (err) {
        log.warn('Could not read or parse package.json', err)
      }
    } catch (err) {
      log.warn('Could not read or parse package.json', err)
    }

    const brokenPackages = []

    for (const pkg of Object.keys(declaredPackages)) {
      try {
        const resolved = await findModuleWithNPM(nova.extension.path, pkg)
        if (!resolved || !resolved.correctVersion) {
          brokenPackages.push(pkg)
        }
      } catch (err) {
        log.warn(`Failed to verify package "${pkg}":`, err)
        brokenPackages.push(pkg)
      }
    }

    if (brokenPackages.length > 0) {
      installReason = `invalid or outdated packages: ${brokenPackages.join(', ')}`
    }

    if (installReason) {
      log.info('Running npm install due to: ', installReason)
      await installPackages(nova.extension.path)
    }

    log.info('Using bundled Prettier.')
    return prettierPath
  } catch (err) {
    if (err.status === 127) throw err
    log.warn('Error trying to find or install bundled Prettier', err)
  }
}
