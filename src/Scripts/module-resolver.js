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
  spawnNode,
  spawnNpm,
} = require('./helpers.js')

const { showNotification } = require('./notifications.js')

const {
  createInstallLock,
  waitForBundledInstall,
} = require('./install-lock.js')

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

/**
 * True when the resolved module directory actually contains a package
 * (a package.json file). Guards against broken installs — e.g. a pnpm
 * symlink pointing at an empty store entry — which would otherwise be
 * picked up and make the service fail to start on every attempt.
 *
 * @param {string} modulePath – resolved module directory
 * @returns {boolean}
 */
function isLoadableModule(modulePath) {
  const stats = nova.fs.stat(nova.path.join(modulePath, 'package.json'))
  return !!stats && stats.isFile()
}

async function findModuleWithNPM(directory, module) {
  const process = await spawnNpm(
    ['ls', String(module), '--parseable', '--long', '--depth', '0'],
    { cwd: directory },
  )

  let resolve, reject
  const promise = new Promise((_resolve, _reject) => {
    resolve = _resolve
    reject = _reject
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
 * Verifies installed packages, one `npm ls` spawn per package, all in
 * parallel, mirroring the original resolution semantics.
 *
 * @param {string}   directory       – cwd for the npm ls invocations
 * @param {string[]} packageNames    – package names to verify
 * @returns {Promise<string[]>}       – names of packages that are broken
 *                                      (missing, outdated, INVALID, MAXDEPTH)
 */
async function verifyBundledPackages(directory, packageNames) {
  const results = await Promise.all(
    packageNames.map(async (pkg) => {
      try {
        const resolved = await findModuleWithNPM(directory, pkg)
        if (!resolved || !resolved.correctVersion) return pkg
        return null
      } catch (err) {
        log.warn(`Failed to verify package "${pkg}":`, err)
        return pkg
      }
    }),
  )

  return results.filter(Boolean)
}

async function installPackages(directory) {
  const process = await spawnNpm(['install', '--omit=dev'], {
    cwd: directory,
  })

  let resolve, reject
  const promise = new Promise((_resolve, _reject) => {
    resolve = _resolve
    reject = _reject
  })

  // npm install can legitimately take a while — give it 5 minutes.
  handleProcessResult(process, reject, resolve, 300000)
  process.start()

  return promise
}

/**
 * Distinctive strings introduced by each bundled patch. Reading them is
 * enough to tell whether a patch is applied — the extension only holds a
 * read-only filesystem entitlement, so "applied" state can't be tracked
 * with a marker file. Each check runs against its own file, so repeated
 * strings across patches are unambiguous.
 */
const PATCH_SIGNATURES = [
  {
    file: ['node_modules', 'prettier-plugin-sh', 'lib', 'index.cjs'],
    signature: 'node?.Pos?.Offset ?? 0',
  },
  {
    file: ['node_modules', '@prettier', 'plugin-xml', 'src', 'parser.js'],
    signature: 'typeof node?.location?.startOffset !== "number"',
  },
  {
    file: ['node_modules', 'prettier-plugin-sql', 'lib', 'index.js'],
    signature: '32 MiB in bytes (characters)',
  },
  {
    file: ['node_modules', 'prettier-plugin-toml', 'lib', 'index.js'],
    signature: '32 MiB in bytes (characters)',
  },
]

/**
 * True when every bundled patch's signature is present in the installed
 * files.
 *
 * @param {string} extensionPath – directory containing node_modules
 * @returns {boolean}
 */
function areBundledPatchesApplied(extensionPath) {
  return PATCH_SIGNATURES.every(({ file, signature }) => {
    try {
      const filePath = nova.path.join(extensionPath, ...file)
      const stats = nova.fs.stat(filePath)
      if (!stats || stats.isDirectory()) return false

      const openedFile = nova.fs.open(filePath, 'r')
      try {
        return openedFile.read().includes(signature)
      } finally {
        openedFile.close()
      }
    } catch (err) {
      log.warn(`Could not check patch state of ${file.join('/')}`, err)
      return false
    }
  })
}

/**
 * Applies the bundled patches with patch-package.
 *
 * npm ≥ 11 blocks postinstall scripts by default, so patches can no
 * longer rely on the `postinstall: patch-package` hook — newer npm
 * versions leave every bundled plugin unpatched after a plain install.
 * patch-package runs as a subprocess (plain process entitlement, no
 * filesystem entitlement needed); whether anything must run is decided
 * by read-only signature checks on the patched files.
 *
 * @param {string} extensionPath – directory containing node_modules and patches/
 */
async function applyBundledPatches(extensionPath) {
  const patchPackageEntry = nova.path.join(
    extensionPath,
    'node_modules',
    'patch-package',
    'dist',
    'index.js',
  )

  if (!nova.fs.stat(patchPackageEntry)) {
    log.warn('patch-package not found — skipping bundled patch application')
    return
  }

  if (areBundledPatchesApplied(extensionPath)) {
    log.debug('Bundled patches already applied.')
    return
  }

  log.info('Applying bundled patches (patch-package)…')

  const process = await spawnNode([patchPackageEntry], {
    cwd: extensionPath,
  })

  let resolve, reject
  const promise = new Promise((_resolve, _reject) => {
    resolve = _resolve
    reject = _reject
  })

  handleProcessResult(process, reject, resolve, 60000)
  process.start()

  try {
    await promise
    log.info('Bundled patches applied.')
  } catch (err) {
    // Non-fatal: unpatched plugins surface as ordinary format errors, and
    // the next resolution retries the application.
    log.warn('Applying bundled patches failed', err)
  }
}

/**
 * Recursively removes a file or directory tree via the Nova file-system
 * API. Note that stat() follows symlinks, so an entry that is itself a
 * symlink to a directory would be recursed into — safe for npm's `.bin`,
 * whose links always point at executable files.
 *
 * @param {string} path – file or directory to remove
 */
async function removeTree(path) {
  const stats = nova.fs.stat(path)
  if (!stats) return

  // The extension only holds a read-only filesystem entitlement, so
  // deletion must happen in a subprocess (plain process entitlement).
  // `rm -rf` recurses on its own, which also avoids following npm's .bin
  // symlinks one level too far.
  let resolve, reject
  const promise = new Promise((_resolve, _reject) => {
    resolve = _resolve
    reject = _reject
  })

  const process = new Process('/usr/bin/env', {
    args: ['rm', '-rf', path],
  })

  handleProcessResult(process, reject, resolve, 30000)
  process.start()

  return promise
}

/**
 * Removes a stale `node_modules/.bin` symlink farm before an install
 * attempt. An interrupted earlier install can leave symlinks in place and
 * make npm fail the whole install with `EEXIST: symlink ... -> .bin/...`;
 * npm fully regenerates `.bin`, so deleting it is always safe.
 *
 * @param {string} directory – extension directory containing node_modules
 */
async function clearStaleBinLinks(directory) {
  try {
    await removeTree(nova.path.join(directory, 'node_modules', '.bin'))
  } catch (err) {
    // Non-fatal: npm recreates .bin and usually copes with leftovers.
    log.warn('Failed to clear stale node_modules/.bin links', err)
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
      if (fsResult && !isLoadableModule(fsResult)) {
        log.warn(
          `Ignoring project prettier at ${fsResult} — no package.json found (broken install?)`,
        )
      } else if (fsResult) {
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
      if (npmResult && !isLoadableModule(npmResult.path)) {
        log.warn(
          `Ignoring project prettier at ${npmResult.path} — no package.json found (broken install?)`,
        )
      } else if (npmResult) {
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

    const packageJsonPath = nova.path.join(nova.extension.path, 'package.json')

    let declaredPackages = {}

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

    // Cross-process install serialization. Nova loads the extension once
    // per workspace window, and every instance installs into the same
    // bundle — a fresh install or an update has two or more processes
    // verifying a mid-install tree and racing their own npm installs
    // (ENOTEMPTY/EEXIST cleanup fights). The lock is a directory created
    // atomically by a subprocess (mkdir), living inside nova.fs.tempdir(),
    // which Nova documents as shared between instances of the same
    // extension — the per-workspace context used previously could never
    // see another window's lock. The lock writes go through subprocesses
    // because the extension process itself is entitlement-blocked from
    // nova.fs writes (in-process fs.open with 'x' silently failed); only
    // the read-side staleness checks stay in-process. The holder
    // heartbeats the directory's mtime while installing; if it dies (Nova
    // killed the process), the lock goes stale after 30s instead of
    // blocking waiters for the full TTL.
    const INSTALL_LOCK_TTL_MS = 5 * 60 * 1000
    const INSTALL_POLL_INTERVAL_MS = 250
    const INSTALL_HEARTBEAT_INTERVAL_MS = 10000

    const installLock = createInstallLock()

    const verifyPackages = () =>
      verifyBundledPackages(nova.extension.path, Object.keys(declaredPackages))

    // With node_modules or the lockfile missing, npm ls can't say
    // anything useful — treat every declared package as broken and go
    // straight to the install path. Computed fresh on every use: after
    // waiting for another process's install, node_modules may well have
    // appeared — a stale value here caused an unnecessary reinstall.
    const hasMissingDeps = () =>
      !nova.fs.stat(nova.path.join(nova.extension.path, 'node_modules')) ||
      !nova.fs.stat(nova.path.join(nova.extension.path, 'package-lock.json'))

    // Any install lock held by another process means the tree may be
    // mid-write — verification against it is meaningless (npm writes
    // package.json files early, so a half-installed tree can pass
    // npm ls). Wait for the lock to clear BEFORE trusting verification.
    if (installLock.isHeld()) {
      log.info(
        'Another extension process is already installing the bundled packages — waiting for it to finish…',
      )
      await waitForBundledInstall(
        prettierPath,
        installLock,
        INSTALL_LOCK_TTL_MS,
        INSTALL_POLL_INTERVAL_MS,
      )
    }

    let missingDeps = hasMissingDeps()
    let brokenPackages = missingDeps
      ? Object.keys(declaredPackages)
      : await verifyPackages()

    if (brokenPackages.length > 0) {
      let installReason = missingDeps
        ? 'missing dependencies'
        : `invalid or outdated packages: ${brokenPackages.join(', ')}`

      // Take the lock ourselves. Losing the atomic create means another
      // process grabbed it after our check above — wait for that
      // install too, then re-verify.
      let ownsInstallLock = await installLock.acquire()

      if (!ownsInstallLock) {
        log.info(
          'Another extension process is already installing the bundled packages — waiting for it to finish…',
        )
        await waitForBundledInstall(
          prettierPath,
          installLock,
          INSTALL_LOCK_TTL_MS,
          INSTALL_POLL_INTERVAL_MS,
        )

        // Fresh state: the waited-out install may have fixed everything.
        missingDeps = hasMissingDeps()
        brokenPackages = missingDeps
          ? Object.keys(declaredPackages)
          : await verifyPackages()
        installReason = missingDeps
          ? 'missing dependencies'
          : `invalid or outdated packages: ${brokenPackages.join(', ')}`

        if (brokenPackages.length > 0) {
          ownsInstallLock = await installLock.acquire()
        }
      }

      // Whether patches were already applied inside a lock we held —
      // they must not run twice against a tree another process may now
      // be installing into.
      let patchesApplied = false

      if (brokenPackages.length > 0 && ownsInstallLock) {
        // Heartbeat while installing: fresh mtime every 10s. Cleared
        // with the lock in finally — a killed process simply stops
        // heartbeating, which is what waiters detect.
        const heartbeat = setInterval(
          () => installLock.heartbeat(),
          INSTALL_HEARTBEAT_INTERVAL_MS,
        )
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
              await clearStaleBinLinks(nova.extension.path)
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

          // Patch while we still hold the lock: if we released first,
          // another window could acquire it and start a fresh install
          // while patch-package rewrites files.
          await applyBundledPatches(nova.extension.path)
          patchesApplied = true
        } finally {
          clearInterval(heartbeat)
          installLock.release()
        }
      } else if (brokenPackages.length > 0 && !ownsInstallLock) {
        // Couldn't take the lock even after waiting (a healthy install
        // outlived our TTL). Degrade to the old racing behavior rather
        // than failing resolution outright — no worse than before the
        // lock existed.
        log.warn(
          'Could not acquire the bundled-install lock — running npm install unlocked as a fallback.',
        )
        await clearStaleBinLinks(nova.extension.path)
        await installPackages(nova.extension.path)
        await applyBundledPatches(nova.extension.path)
        patchesApplied = true
      }

      if (!patchesApplied) {
        // Patch the just-installed tree we verified above. Safe: any
        // held lock was waited out before verification, and we hold no
        // lock ourselves anymore.
        await applyBundledPatches(nova.extension.path)
      }
    } else {
      // Verification passed with no lock held — but a pre-existing
      // node_modules may have been installed with an npm version that
      // skipped postinstall scripts.
      await applyBundledPatches(nova.extension.path)
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
