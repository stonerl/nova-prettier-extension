/**
 * processes.js — Subprocess result contract for Prettier⁺ for Nova
 *
 * @license MIT
 * @author Toni Förster
 * @copyright © 2026 Toni Förster
 *
 * Wire up resolution/rejection for a spawned Nova Process and its
 * timeout handling — the shared contract every subprocess caller uses.
 */

class ProcessError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

/**
 * Rebuild a real Error from a serialized error payload received over
 * the wire — the service sends { name, message, stack? } envelopes for
 * handler-level errors, crash and startup failures alike.
 *
 * @param {{ name?: string, message?: string, stack?: string }} payload
 * @returns {Error}
 */
function rehydrateError(payload) {
  const error = new Error(payload?.message ?? 'Unknown error')
  if (payload) Object.assign(error, payload)
  return error
}

/**
 * Wire up rejection/resolution for a Nova Process based on its stderr
 * and exit status, with an optional inactivity-free timeout so a hung
 * child process can't block the caller forever.
 *
 * @param {Process} process
 * @param {Function} reject
 * @param {Function} resolve
 * @param {number} [timeoutMs=30000]  – 0 disables the timeout
 */
function handleProcessResult(process, reject, resolve, timeoutMs = 30000) {
  const errors = []
  let settled = false

  const settle = (fn, value) => {
    if (settled) return
    settled = true
    fn(value)
  }

  process.onStderr((err) => {
    errors.push(err)
  })

  process.onDidExit((status) => {
    if (status === 0) {
      settle(resolve)
      return
    }

    settle(reject, new ProcessError(status, errors.join('\n')))
  })

  if (timeoutMs > 0) {
    setTimeout(() => {
      if (settled) return
      try {
        process.terminate()
      } catch {
        // already exited
      }
      settle(
        reject,
        new ProcessError(-1, `Process timed out after ${timeoutMs}ms`),
      )
    }, timeoutMs)
  }
}

module.exports = { ProcessError, handleProcessResult, rehydrateError }
