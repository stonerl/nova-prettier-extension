/**
 * install-lock.js — Cross-process lock for bundled-package installs
 *
 * @license MIT
 * @author Toni Förster
 * @copyright © 2026 Toni Förster
 *
 * Nova loads the extension once per workspace window and every instance
 * installs the bundled packages into the same shared bundle — two or
 * more extension processes booting at once race their `npm install`s
 * against the same node_modules tree and can leave the bundle broken.
 *
 * The lock is a directory, created atomically by running `mkdir` in a
 * subprocess: POSIX mkdir fails when the path already exists, so
 * exactly one process wins. The holder heartbeats by `touch`ing the
 * directory; a process that dies stops heartbeating, so the lock goes
 * stale after `staleMs` and another instance can take over. Read-side
 * staleness checks (`nova.fs.stat`) stay in-process.
 *
 * All writes run through subprocesses because the extension process
 * only holds a read-only filesystem entitlement — Nova rejects
 * in-process `nova.fs` writes (the earlier `fs.open(path, 'x')` scheme
 * silently failed); subprocesses run with the plain process
 * entitlement and may write.
 *
 * The lock lives in `nova.fs.tempdir()` (Nova 10+), documented as
 * shared between instances of the same extension running in different
 * workspaces; older versions fall back to the global storage path.
 *
 * Tool writes spawn absolute system binaries (/bin/mkdir, …) rather
 * than resolving them through `/usr/bin/env`: some users' shell setups
 * leave Nova's environment PATH without /bin, where `env` itself runs
 * but "env: mkdir: No such file or directory" kills every lookup.
 */

const { handleProcessResult, log } = require('./helpers.js')

const LOCK_FILE_NAME = 'prettier-bundled-install.lock'

/**
 * Absolute path of the lock directory, stable across all workspace
 * windows. Returns an object so callers can tell whether the pre-Nova-10
 * fallback is in use (its parent needs a one-time mkdir -p).
 *
 * @returns {{ path: string, usesFallback: boolean }}
 */
function installLockLocation() {
  // tempdir() is added in Nova 10 — guard for older versions.
  const directory =
    typeof nova.fs.tempdir === 'function' ? nova.fs.tempdir() : null

  if (directory) {
    return {
      path: nova.path.join(directory, LOCK_FILE_NAME),
      usesFallback: false,
    }
  }

  log.warn(
    'nova.fs.tempdir is unavailable — install lock falls back to the ' +
      'extension global storage path.',
  )
  return {
    path: nova.path.join(nova.extension.globalStoragePath, LOCK_FILE_NAME),
    usesFallback: true,
  }
}

/**
 * Absolute paths for the coreutils tools the lock runs. Invoking them
 * directly (not via `/usr/bin/env <tool>`) keeps lock writes
 * independent of the PATH Nova's environment provides — some users'
 * broken shell setups omit /bin and /usr/bin, where `env` starts fine
 * but fails to resolve `mkdir` ("env: mkdir: No such file or
 * directory").
 */
const TOOL_PATHS = {
  mkdir: '/bin/mkdir',
  touch: '/usr/bin/touch',
  rmdir: '/bin/rmdir',
  rm: '/bin/rm',
}

/**
 * Runs a coreutils tool (`mkdir`, `touch`, `rmdir`, `rm`) in a
 * subprocess and resolves on exit 0, rejecting with the exit status
 * otherwise. `args` is the tool invocation without the binary name,
 * e.g. ["mkdir", "-p", path].
 *
 * @param {string[]} args
 * @param {number} [timeoutMs]
 * @returns {Promise<void>}
 */
function runTool(args, timeoutMs = 15000) {
  let resolve, reject
  const promise = new Promise((_resolve, _reject) => {
    resolve = _resolve
    reject = _reject
  })

  const process = new Process(TOOL_PATHS[args[0]], { args: args.slice(1) })

  handleProcessResult(process, reject, resolve, timeoutMs)
  process.start()

  return promise
}

/**
 * Creates a lock instance for serializing bundled-package installs
 * across all running extension processes.
 *
 * @param {object} [options]
 * @param {number} [options.staleMs] – lock age after which the holder is
 *                                     considered dead (no heartbeat)
 * @returns {{
 *   path: string,
 *   acquire: () => Promise<boolean>,
 *   release: () => Promise<void>,
 *   isHeld: () => boolean,
 *   heartbeat: () => Promise<void>,
 * }}
 */
function createInstallLock({ staleMs = 30000 } = {}) {
  const { path, usesFallback } = installLockLocation()

  const acquire = async () => {
    // Pre-Nova-10 fallback: the global storage path may not exist yet —
    // mkdir -p is idempotent and only touches the parent, leaving the
    // lock path's EEXIST semantics unaffected.
    if (usesFallback) {
      try {
        await runTool(['mkdir', '-p', nova.extension.globalStoragePath])
      } catch (err) {
        log.warn('Could not create the extension global storage directory', err)
        return false
      }
    }

    const stats = nova.fs.stat(path)

    if (stats) {
      if (Date.now() - stats.mtime.getTime() < staleMs) {
        return false // a live holder owns the lock
      }

      // Stale lock — previous holder died mid-install. Remove and try
      // to take over; a losing race here is harmless.
      log.info('Stale bundled-install lock detected — taking it over.')
      try {
        await runTool(['rm', '-rf', path])
      } catch (err) {
        log.warn('Could not remove the stale install lock', err)
      }
    }

    try {
      // Atomic create — fails when another process won the race.
      await runTool(['mkdir', path])
      return true
    } catch (err) {
      // "someone else was faster" (expected) stays quiet; a broken
      // environment (parent missing, permissions…) gets a warning.
      if (nova.fs.stat(path)) {
        log.info(
          'Lost the race for the bundled-install lock — another process is installing.',
        )
      } else {
        log.warn('Could not create the bundled-install lock', err)
      }
      return false
    }
  }

  const release = async () => {
    try {
      await runTool(['rmdir', path])
    } catch {
      // lock already gone (stale takeover released it) — a stubborn
      // lock dir is cleaned up by the next holder's stale detection
    }
  }

  const isHeld = () => {
    try {
      const stats = nova.fs.stat(path)
      return !!stats && Date.now() - stats.mtime.getTime() < staleMs
    } catch (err) {
      log.warn('Could not check the bundled-install lock', err)
      return false
    }
  }

  const heartbeat = async () => {
    try {
      // touch refreshes the mtime the staleness check reads
      await runTool(['touch', path])
    } catch (err) {
      // Non-fatal: if the lock vanished, waiters take the stale path.
      log.warn('Could not refresh the bundled-install lock', err)
    }
  }

  return { path, acquire, release, isHeld, heartbeat }
}

/**
 * Waits until another extension process's bundled-packages install is
 * done: the install lock has been released by its holder, or it has
 * gone stale because a process Nova killed mid-install stopped
 * heartbeating. Bails out after `ttlMs` at the latest.
 *
 * Deliberately does NOT exit when Prettier's package.json appears on
 * disk: npm writes it early during an install, so its existence doesn't
 * mean the tree is complete — readiness is decided by the caller's
 * verification after this wait.
 *
 * @param {string} prettierPath – path of the bundled prettier module
 *                              (unused today, kept for call-site clarity)
 * @param {object} lock         – lock instance from createInstallLock()
 * @param {number} ttlMs        – overall wait deadline
 * @param {number} pollMs       – polling interval
 */
async function waitForBundledInstall(prettierPath, lock, ttlMs, pollMs = 250) {
  const deadline = Date.now() + ttlMs

  while (Date.now() < deadline) {
    // Lock released (directory gone), or holder stopped heartbeating
    if (!lock.isHeld()) return

    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
}

module.exports = { createInstallLock, waitForBundledInstall }
