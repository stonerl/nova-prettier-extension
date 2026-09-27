/**
 * install-lock.js — Cross-process lock for bundled-package installs
 *
 * @license MIT
 * @author Toni Förster
 * @copyright © 2026 Toni Förster
 *
 * Nova loads extensions once per workspace window, and every instance
 * installs the bundled packages into the same shared extension bundle.
 * A fresh install or an update therefore has two or more extension
 * processes booting at the same time, each running its own `npm install`
 * against the same node_modules tree — the installs race each other
 * (ENOTEMPTY/EEXIST cleanup fights) and can leave the bundle broken.
 *
 * This module provides a lock that all extension processes share:
 *
 *   • The lock is a directory, created atomically by running `mkdir` in
 *     a subprocess. POSIX mkdir fails when the path already exists, so
 *     exactly one process wins — the losers see the directory and wait.
 *   • The holder heartbeats by `touch`ing the directory, refreshing its
 *     mtime. A process that dies (Nova killed it) stops heartbeating, so
 *     the lock goes stale after `staleMs` and another instance can take
 *     it over instead of blocking waiters for the full TTL. Read-side
 *     staleness checks (`nova.fs.stat`) stay in-process — reading is
 *     always allowed.
 *
 * All writes run through subprocesses (`/usr/bin/env mkdir/touch/rmdir/
 * rm`) because the extension itself only holds a read-only filesystem
 * entitlement: Nova rejects in-process `nova.fs` writes even inside its
 * own tempdir, which is why the earlier `fs.open(path, 'x')` approach
 * silently failed. Subprocesses run with the plain process entitlement
 * and may write — the same mechanism removeTree() in module-resolver.js
 * already uses for deletions.
 *
 * The lock lives in `nova.fs.tempdir()` (Nova 10+), which is documented
 * as shared between instances of the same extension running in
 * different workspaces. On older versions it falls back to the
 * extension's global storage path.
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

  return {
    path: nova.path.join(nova.extension.globalStoragePath, LOCK_FILE_NAME),
    usesFallback: true,
  }
}

/**
 * Runs a coreutils tool (`mkdir`, `touch`, `rmdir`, `rm`) in a
 * subprocess and resolves on exit 0, rejecting with the exit status
 * otherwise — mirroring how removeTree() spawns `/usr/bin/env rm`.
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

  const process = new Process('/usr/bin/env', { args })

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
    // Pre-Nova-10 fallback: the global storage path may not exist yet
    // ("the directory itself may not exist"). mkdir -p is idempotent and
    // only touches the parent, so the lock path's EEXIST semantics are
    // unaffected.
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
        return false // A live holder owns the lock.
      }

      // Stale lock — the previous holder died mid-install. Remove it
      // and try to take over. A losing race here is harmless: the
      // winner removes nothing or creates the lock first.
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
      // Distinguish "someone else was faster" (expected during races)
      // from a broken environment (parent missing, permissions…). The
      // former is quiet; the latter gets a warning so entitlement or
      // path problems surface in the Extension Console.
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
      // Fails when the lock is already gone (stale takeover released
      // it for us) — nothing to do. A lock dir that refuses to go away
      // is cleaned up by the next holder's stale detection.
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
      // touch refreshes the directory mtime the staleness check reads.
      await runTool(['touch', path])
    } catch (err) {
      // Non-fatal: if the lock vanished, waiters fall through to the
      // stale-lock path and take over.
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
 * disk: npm writes it early during an install, so its existence does
 * not mean the tree is complete. Readiness is decided by the caller's
 * verification after this wait returns — the only signal that can tell
 * a finished tree from a mid-write one.
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
    // Lock released (directory gone), or the holder stopped
    // heartbeating.
    if (!lock.isHeld()) return

    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
}

module.exports = { createInstallLock, waitForBundledInstall }
