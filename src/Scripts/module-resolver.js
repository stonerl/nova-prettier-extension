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
} = require('./helpers.js')

const { showNotification } = require('./notifications.js')

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
      let json
      try {
        try {
          json = JSON.parse(file.read())
        } finally {
          file.close()
        }
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

/**
 * Verifies installed packages one by one with a single `npm ls` spawn per
 * package, mirroring the original resolution semantics.
 *
 * @param {string}   directory       – cwd for the npm ls invocations
 * @param {string[]} packageNames    – package names to verify
 * @returns {Promise<string[]>}       – names of packages that are broken
 *                                      (missing, outdated, INVALID, MAXDEPTH)
 */
async function verifyBundledPackages(directory, packageNames) {
  const brokenPackages = []

  for (const pkg of packageNames) {
    try {
      const resolved = await findModuleWithNPM(directory, pkg)
      if (!resolved || !resolved.correctVersion) {
        brokenPackages.push(pkg)
      }
    } catch (err) {
      log.warn(`Failed to verify package "${pkg}":`, err)
      brokenPackages.push(pkg)
    }
  }

  return brokenPackages
}

async function installPackages(directory) {
  let resolve, reject
  const promise = new Promise((_resolve, _reject) => {
    resolve = _resolve
    reject = _reject
  })

  const process = new Process('/usr/bin/env', {
    args: ['npm', 'install', '--omit=dev'],
    cwd: directory,
  })

  // npm install can legitimately take a while — give it 5 minutes.
  handleProcessResult(process, reject, resolve, 300000)
  process.start()

  return promise
}

/**
 * Recursively removes a file or directory tree via the Nova file-system
 * API. Note that stat() follows symlinks, so an entry that is itself a
 * symlink to a directory would be recursed into — safe for npm's `.bin`,
 * whose links always point at executable files.
 *
 * @param {string} path – file or directory to remove
 */
function removeTree(path) {
  const stats = nova.fs.stat(path)
  if (!stats) return

  if (stats.isDirectory()) {
    for (const entry of nova.fs.listdir(path)) {
      removeTree(nova.path.join(path, entry))
    }
    nova.fs.rmdir(path)
  } else {
    nova.fs.remove(path)
  }
}

/**
 * Removes a stale `node_modules/.bin` symlink farm before an install
 * attempt. An interrupted earlier install can leave symlinks in place and
 * make npm fail the whole install with `EEXIST: symlink ... -> .bin/...`;
 * npm fully regenerates `.bin`, so deleting it is always safe.
 *
 * @param {string} directory – extension directory containing node_modules
 */
function clearStaleBinLinks(directory) {
  try {
    removeTree(nova.path.join(directory, 'node_modules', '.bin'))
  } catch (err) {
    // Non-fatal: npm recreates .bin and usually copes with leftovers.
    log.warn('Failed to clear stale node_modules/.bin links', err)
  }
}

/**
 * Waits until another extension process's bundled-packages install is
 * done: either Prettier itself has appeared on disk, or the install lock
 * has gone stale — released by the holder, or no longer heartbeated by a
 * process Nova killed mid-install. Bails out after `ttlMs` at the latest.
 *
 * @param {string} prettierPath   – path of the bundled prettier module
 * @param {string} lockKey        – nova.workspace.context key holding the lock
 * @param {number} ttlMs          – overall wait deadline
 * @param {number} pollMs         – polling interval
 * @param {number} staleMs        – lock age after which the holder is
 *                                  considered dead (no heartbeat)
 */
async function waitForBundledInstall(
  prettierPath,
  lockKey,
  ttlMs,
  pollMs = 250,
  staleMs = 30000,
) {
  const deadline = Date.now() + ttlMs

  while (Date.now() < deadline) {
    // Prettier landed on disk — good enough to start loading
    if (nova.fs.stat(nova.path.join(prettierPath, 'package.json'))) return

    // Lock released (set to 0), or the holder stopped heartbeating
    const lockTs = nova.workspace.context.get(lockKey) || 0
    if (Date.now() - lockTs > staleMs) return

    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
}

module.exports = async function () {
  const nodeVersion = await getNodeVersion()
  const npmVersion = await getNpmVersion()

  // If either npm or Node isn’t detected, error out immediately
  if (npmVersion === 'unknown' || nodeVersion === 'unknown') {
    await showNotification({
      id: 'prettier-resolution-error',
      title: nova.localize(
        'prettier.notification.runtimeMissing.title',
        'Missing Runtime Tools',
        'notification',
      ),
      body: nova.localize(
        'prettier.notification.runtimeMissing.body',
        'Please install Node.js (which includes npm) and ensure it’s on your PATH so Prettier⁺ can resolve correctly. Then restart Nova to apply the change.',
        'notification',
      ),
    })
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

    let declaredPackages = {}

    try {
      const packageJsonPath = nova.path.join(
        nova.extension.path,
        'package.json',
      )

      try {
        const file = nova.fs.open(packageJsonPath, 'r') // Open the file for reading
        let json
        try {
          json = JSON.parse(file.read()) // Parse the JSON string
        } finally {
          file.close()
        }

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

    // Cross-process install serialization. Nova reactivates the extension
    // while npm install writes files into the bundle, and each fresh
    // process would otherwise verify a mid-install tree and start its own
    // npm install, racing the running one (ENOTEMPTY cleanup errors).
    // The lock lives in the workspace context so it survives extension
    // reloads; writing it is safe here because findPrettier runs through
    // the async chain after activation has returned, not inside the
    // deferred config-setup window. The holder heartbeats its timestamp
    // while installing — if it dies (Nova killed the process), the lock
    // goes stale after 30s instead of blocking waiters for the full TTL.
    const INSTALL_LOCK_KEY = 'prettier.bundled.install.inProgress'
    const INSTALL_LOCK_TTL_MS = 5 * 60 * 1000
    const INSTALL_POLL_INTERVAL_MS = 250
    const INSTALL_HEARTBEAT_INTERVAL_MS = 10000
    const INSTALL_LOCK_STALE_MS = 30000

    const installLockHeld = () => {
      const ts = nova.workspace.context.get(INSTALL_LOCK_KEY) || 0
      return Date.now() - ts < INSTALL_LOCK_STALE_MS
    }

    const verifyPackages = () =>
      verifyBundledPackages(nova.extension.path, Object.keys(declaredPackages))

    // With node_modules or the lockfile missing, npm ls can't say
    // anything useful — treat every declared package as broken and go
    // straight to the install path.
    const missingDeps = !nodeModulesExists || !lockfileExists
    let brokenPackages = missingDeps
      ? Object.keys(declaredPackages)
      : await verifyPackages()

    if (brokenPackages.length > 0 && installLockHeld()) {
      log.info(
        'Another extension process is already installing the bundled packages — waiting for it to finish…',
      )
      await waitForBundledInstall(
        prettierPath,
        INSTALL_LOCK_KEY,
        INSTALL_LOCK_TTL_MS,
        INSTALL_POLL_INTERVAL_MS,
      )

      // The other process may have installed everything by now
      brokenPackages = await verifyPackages()
    }

    if (brokenPackages.length > 0) {
      // The lock may have been acquired while we were verifying or
      // waiting above — check once more before taking it ourselves.
      if (installLockHeld()) {
        await waitForBundledInstall(
          prettierPath,
          INSTALL_LOCK_KEY,
          INSTALL_LOCK_TTL_MS,
          INSTALL_POLL_INTERVAL_MS,
        )
        brokenPackages = await verifyPackages()
      }

      if (brokenPackages.length > 0) {
        const installReason = missingDeps
          ? 'missing dependencies'
          : `invalid or outdated packages: ${brokenPackages.join(', ')}`

        nova.workspace.context.set(INSTALL_LOCK_KEY, Date.now())
        // Heartbeat while installing: fresh timestamp every 10s. Cleared
        // with the lock in finally — and a killed process simply stops
        // heartbeating, which is what waiters detect.
        const heartbeat = setInterval(() => {
          nova.workspace.context.set(INSTALL_LOCK_KEY, Date.now())
        }, INSTALL_HEARTBEAT_INTERVAL_MS)
        try {
          log.info('Running npm install due to: ', installReason)

          // npm install can fail transiently (ENOTEMPTY/EEXIST races when
          // an older extension process's orphaned install is still
          // cleaning up node_modules, or a stale symlink farm left behind
          // by an interrupted install) — clear node_modules/.bin and
          // retry once before surfacing a hard error.
          const MAX_INSTALL_ATTEMPTS = 2
          const INSTALL_RETRY_DELAY_MS = 2000

          for (let attempt = 1; attempt <= MAX_INSTALL_ATTEMPTS; attempt++) {
            try {
              clearStaleBinLinks(nova.extension.path)
              await installPackages(nova.extension.path)
              break
            } catch (err) {
              if (attempt === MAX_INSTALL_ATTEMPTS) throw err
              log.warn(
                `npm install failed (attempt ${attempt}/${MAX_INSTALL_ATTEMPTS}), retrying in ${INSTALL_RETRY_DELAY_MS}ms`,
                err,
              )
              await new Promise((resolve) =>
                setTimeout(resolve, INSTALL_RETRY_DELAY_MS),
              )
            }
          }
        } finally {
          clearInterval(heartbeat)
          nova.workspace.context.set(INSTALL_LOCK_KEY, 0)
        }
      }
    }

    log.info('Using bundled Prettier.')
    return prettierPath
  } catch (err) {
    if (err.status === 127) throw err
    log.warn('Error trying to find or install bundled Prettier', err)
    // Rethrow so callers can surface a real error instead of an
    // undefined module path that crashes the Prettier service later.
    throw err
  }
}
