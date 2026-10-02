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
  log,
  readJsonFile,
} = require('./helpers.js')

const {
  getNodeVersion,
  getNpmVersion,
  spawnNode,
  spawnNpm,
} = require('./runtime.js')

const { handleProcessResult } = require('./processes.js')

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

// Broken project installs persist until the user fixes them, and every
// resolution re-runs the guard — dedupe per path so repeats log at debug
// level instead of re-printing the warn.
const warnedBrokenModulePaths = new Set()

/**
 * Warns that a project Prettier install was skipped in favor of the
 * bundled one, once per path.
 *
 * @param {string} modulePath – the skipped module directory
 * @param {string} reason     – why the install is skipped, for the log
 */
function warnBrokenProjectPrettier(modulePath, reason) {
  if (warnedBrokenModulePaths.has(modulePath)) {
    log.debug(
      `Project prettier at ${modulePath} is still unusable (${reason}) — skipping (already reported).`,
    )
    return
  }

  warnedBrokenModulePaths.add(modulePath)
  log.warn(
    `Ignoring project prettier at ${modulePath} — ${reason} — using the bundled Prettier instead.`,
  )
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
 * Checks a package against package-lock.json by reading files only: the
 * installed package.json must exist and its version must match the
 * version the lockfile pins. Spawns nothing, so it stays fast even when
 * the machine is under heavy load.
 *
 * @param {string} directory – directory holding package-lock.json
 * @param {object|null} lock – parsed package-lock.json (v2/v3), or null
 * @param {string} pkg       – package name
 * @returns {boolean}         – true when the install matches the lockfile
 */
function isPackageInstalledPerLockfile(directory, lock, pkg) {
  const locked = lock?.packages?.[`node_modules/${pkg}`]
  if (!locked?.version) return false

  const installed = readJsonFile(
    nova.path.join(directory, 'node_modules', pkg, 'package.json'),
  )
  return !!installed && installed.version === locked.version
}

/**
 * Verifies installed packages. Packages that match package-lock.json are
 * accepted from the filesystem alone; only the rest fall back to `npm ls`,
 * a few at a time so a loaded machine isn't hit with one node process per
 * package (which made every check time out and forced a needless
 * reinstall).
 *
 * @param {string}   directory       – cwd for the npm ls invocations
 * @param {string[]} packageNames    – package names to verify
 * @returns {Promise<string[]>}       – names of packages that are broken
 *                                      (missing, outdated, INVALID, MAXDEPTH)
 */
async function verifyBundledPackages(directory, packageNames) {
  const lock = readJsonFile(nova.path.join(directory, 'package-lock.json'))

  const broken = []
  const unverified = []
  for (const pkg of packageNames) {
    if (isPackageInstalledPerLockfile(directory, lock, pkg)) continue
    if (
      !nova.fs.stat(
        nova.path.join(directory, 'node_modules', pkg, 'package.json'),
      )
    ) {
      broken.push(pkg)
    } else {
      unverified.push(pkg)
    }
  }
  if (unverified.length === 0) {
    return packageNames.filter((pkg) => broken.includes(pkg))
  }

  log.debug(`Verifying with npm: ${unverified.join(', ')}`)

  const NPM_CONCURRENCY = 4
  const queue = [...unverified]
  const worker = async () => {
    while (queue.length) {
      const pkg = queue.shift()
      try {
        const resolved = await findModuleWithNPM(directory, pkg)
        if (!resolved || !resolved.correctVersion) broken.push(pkg)
      } catch (err) {
        // A timeout says the machine is busy, not that the package is
        // broken — it is installed (package.json exists), so keep it
        // rather than forcing a reinstall that would time out as well.
        if (err.status === -1) {
          log.warn(
            `Could not verify package "${pkg}" in time — assuming the installed copy is usable`,
          )
          continue
        }
        log.warn(`Failed to verify package "${pkg}":`, err)
        broken.push(pkg)
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(NPM_CONCURRENCY, queue.length) }, worker),
  )

  // Keep the caller's order for stable log output
  return packageNames.filter((pkg) => broken.includes(pkg))
}

async function installPackages(directory) {
  // Pin npm's script shell: npm resolves the bare `sh` for lifecycle
  // scripts through PATH, and environments with a broken PATH spawn
  // nothing ("spawn sh ENOENT"). /bin/sh exists on every macOS.
  const process = await spawnNpm(['install', '--omit=dev'], {
    cwd: directory,
    env: { npm_config_script_shell: '/bin/sh' },
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
 * Distinctive strings introduced by each bundled patch. The extension
 * only holds a read-only filesystem entitlement, so "applied" state
 * can't be tracked with a marker file — reading is enough. Each check
 * runs against its own file, so repeated strings are unambiguous.
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
 * npm ≥ 11 blocks postinstall scripts by default, so the old
 * `postinstall: patch-package` hook leaves every bundled plugin
 * unpatched after a plain install. patch-package runs as a subprocess
 * (plain process entitlement); whether it must run is decided by
 * read-only signature checks.
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
 * Removes development-only files (sourcemaps, TypeScript typings, docs,
 * node-sql-parser's browser builds) from the bundled node_modules. Runs
 * in a subprocess — the extension's read-only entitlement prevents
 * in-process deletion, same as applyBundledPatches. The script is
 * idempotent and stays silent on an already-pruned tree, so repeated
 * bundled resolutions add no noise.
 *
 * @param {string} extensionPath – directory containing node_modules and Scripts/
 */
async function pruneBundledNodeModules(extensionPath) {
  const scriptPath = nova.path.join(
    extensionPath,
    'Scripts',
    'prune-runtime-deps.js',
  )

  if (!nova.fs.stat(scriptPath)) {
    log.debug('prune-runtime-deps.js not found — skipping bundled prune')
    return
  }

  try {
    const process = await spawnNode([scriptPath], { cwd: extensionPath })

    let resolve, reject
    const promise = new Promise((_resolve, _reject) => {
      resolve = _resolve
      reject = _reject
    })

    const output = []
    process.onStdout((line) => output.push(line))

    handleProcessResult(process, reject, resolve, 120000)
    process.start()

    await promise
    const summary = output.join('').trim()
    if (summary) {
      log.info(summary)
    }
  } catch (err) {
    // Non-fatal: leftover dev files only waste disk, never break formats.
    log.warn('Pruning bundled node_modules failed', err)
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
  // `rm -rf` recurses on its own, avoiding npm's .bin symlinks. The
  // absolute binary keeps the call PATH-independent — some users'
  // broken shell setups leave `/usr/bin/env` unable to resolve `rm`.
  let resolve, reject
  const promise = new Promise((_resolve, _reject) => {
    resolve = _resolve
    reject = _reject
  })

  const process = new Process('/bin/rm', {
    args: ['-rf', path],
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

/**
 * Verifies the bundled module tree under the extension directory and
 * (re)installs it when packages are missing or invalid, then applies
 * the bundled patches and prunes development-only files. Installs are
 * serialized across extension processes via the install lock, so this
 * can run from a resolution as well as from a background task.
 *
 * @returns {Promise<string>} – path to the bundled Prettier module
 */
async function ensureBundledModules() {
  try {
    const prettierPath = nova.path.join(
      nova.extension.path,
      'node_modules',
      'prettier',
    )

    const packageJsonPath = nova.path.join(nova.extension.path, 'package.json')

    let declaredPackages = {}

    try {
      const file = nova.fs.open(packageJsonPath, 'r')
      let json
      try {
        json = JSON.parse(file.read())
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
    // per workspace window and every instance installs into the same
    // bundle — installs race each other (ENOTEMPTY/EEXIST fights). The
    // lock is a subprocess-created directory inside nova.fs.tempdir(),
    // documented as shared between instances of the same extension.
    // Lock writes go through subprocesses because the extension process
    // is entitlement-blocked from nova.fs writes; the holder heartbeats
    // the directory mtime so a killed process's lock goes stale after 30s.
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

      await pruneBundledNodeModules(nova.extension.path)
    } else {
      // Verification passed with no lock held — but a pre-existing
      // node_modules may have been installed with an npm version that
      // skipped postinstall scripts.
      await applyBundledPatches(nova.extension.path)
      await pruneBundledNodeModules(nova.extension.path)
    }

    log.info('Using bundled Prettier.')
    return prettierPath
  } catch (err) {
    if (err.status === 127) throw err
    log.warn('Error trying to find or install bundled Prettier', err)
    throw err
  }
}

// In-process singleflight — several resolutions can fire while one
// background install is still running.
let pendingBackgroundEnsure = null

/**
 * Populates the bundled tree while a project Prettier serves the
 * service. Fresh extension installs ship an empty bundle (the release
 * strips node_modules), so without this the bundled plugins stay
 * missing until a bundled resolution happens to run. Errors are
 * logged, never thrown — the project Prettier keeps formatting.
 *
 * @returns {Promise<void>} – settles when the install attempt finished
 */
function ensureBundledModulesInBackground() {
  if (pendingBackgroundEnsure) return pendingBackgroundEnsure

  log.info('Populating the bundled modules in background…')
  pendingBackgroundEnsure = ensureBundledModules()
    .catch((err) => {
      log.warn('Background install of bundled modules failed', err)
    })
    .finally(() => {
      pendingBackgroundEnsure = null
    })
  return pendingBackgroundEnsure
}

async function findPrettier() {
  const nodeVersion = await getNodeVersion()
  const npmVersion = await getNpmVersion()

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
    throw new Error('Missing runtime tools: Node.js and npm are required.')
  }

  log.debug(`node Version: ${nodeVersion}\nnpm Version: ${npmVersion}`)

  const preferBundled = getConfigWithWorkspaceOverride(
    'prettier.module.preferBundled',
  )

  // Try finding in the workspace
  if (nova.workspace.path && !preferBundled) {
    // File system first
    try {
      const fsResult = findModuleWithFileSystem(nova.workspace.path, 'prettier')
      if (fsResult && !isLoadableModule(fsResult)) {
        warnBrokenProjectPrettier(
          fsResult,
          'no package.json found (broken install?)',
        )
      } else if (fsResult) {
        log.info(`Loading project prettier (fs) at ${fsResult}`)
        // The service runs the project Prettier; populate the bundled
        // tree in the background so a later bundled resolution (user
        // enables preferBundled, opens a project without Prettier, or
        // the project install breaks) finds it ready.
        ensureBundledModulesInBackground()
        return fsResult
      }
    } catch (err) {
      log.warn(
        'Error trying to find workspace Prettier using file system',
        err,
        err.stack,
      )
    }

    // npm as an alternative
    try {
      const npmResult = await findModuleWithNPM(nova.workspace.path, 'prettier')
      if (npmResult && !isLoadableModule(npmResult.path)) {
        warnBrokenProjectPrettier(
          npmResult.path,
          'no package.json found (broken install?)',
        )
      } else if (npmResult && !npmResult.correctVersion) {
        // Same philosophy as the missing-package.json guard: an install
        // npm ls reports as invalid or outdated must not take the service
        // down (start would fail ×3 with no fallback).
        warnBrokenProjectPrettier(
          npmResult.path,
          'npm ls reports it as invalid or outdated',
        )
      } else if (npmResult) {
        log.info(`Loading project prettier (npm) at ${npmResult.path}`)
        ensureBundledModulesInBackground()
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

  // No usable project Prettier (or preferBundled) — ensure the bundled
  // tree and load from it.
  return ensureBundledModules()
}

module.exports = {
  findPrettier,
  isLoadableModule,
  ensureBundledModulesInBackground,
}
