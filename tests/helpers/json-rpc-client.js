/**
 * json-rpc-client.js — Minimal JSON-RPC client for testing the Prettier service
 *
 * @license MIT
 * @author Toni Förster
 * @copyright © 2026 Toni Förster
 *
 * Spawns prettier-service.js as a subprocess and speaks the same
 * Content-Length framed JSON-RPC 2.0 protocol the extension uses.
 */

const { spawn } = require('child_process')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const BUILT_SERVICE = path.join(
  ROOT,
  'prettier.novaextension',
  'Scripts',
  'prettier-service',
  'prettier-service.js',
)
const BUNDLED_PRETTIER = path.join(
  ROOT,
  'prettier.novaextension',
  'node_modules',
  'prettier',
)

/**
 * Distinctive strings introduced by each bundled patch — same list and
 * rationale as PATCH_SIGNATURES in src/Scripts/module-resolver.js.
 */
const PATCH_SIGNATURES = [
  ['node_modules/prettier-plugin-sh/lib/index.cjs', 'node?.Pos?.Offset ?? 0'],
  [
    'node_modules/@prettier/plugin-xml/src/parser.js',
    'typeof node?.location?.startOffset !== "number"',
  ],
  [
    'node_modules/prettier-plugin-sql/lib/index.js',
    '32 MiB in bytes (characters)',
  ],
  [
    'node_modules/prettier-plugin-toml/lib/index.js',
    '32 MiB in bytes (characters)',
  ],
]

const EXTENSION_DIR = path.join(ROOT, 'prettier.novaextension')

/**
 * Assert that the built service and the bundled Prettier module exist,
 * with actionable guidance when they don't. Also makes sure the bundled
 * plugin patches are applied — npm ≥ 11 skips postinstall scripts, so a
 * plain `npm install` leaves the plugins unpatched and cursor tracking
 * crashes on some of them.
 */
function requireBuiltArtifacts() {
  const fs = require('fs')

  if (!fs.existsSync(BUILT_SERVICE)) {
    console.error(
      'Built Prettier service not found. Run `npm run build` in the repository root first.',
    )
    process.exit(1)
  }

  if (!fs.existsSync(path.join(BUNDLED_PRETTIER, 'package.json'))) {
    console.error(
      'Bundled Prettier module not found. Run `npm install --omit=dev` inside prettier.novaextension/ first.',
    )
    process.exit(1)
  }

  const patchPackage = path.join(
    EXTENSION_DIR,
    'node_modules',
    'patch-package',
    'dist',
    'index.js',
  )

  const allApplied = PATCH_SIGNATURES.every(([relativeFile, signature]) => {
    try {
      return fs
        .readFileSync(path.join(EXTENSION_DIR, relativeFile), 'utf8')
        .includes(signature)
    } catch {
      return false
    }
  })

  if (!allApplied && fs.existsSync(patchPackage)) {
    console.log('Applying bundled patches (patch-package)…')
    try {
      require('child_process').execSync(`node "${patchPackage}"`, {
        cwd: EXTENSION_DIR,
        stdio: 'inherit',
        timeout: 60000,
      })
    } catch (err) {
      console.error('Applying bundled patches failed:', err.message)
    }
  }
}

/**
 * Spawn the built service and return a promise-based JSON-RPC client.
 *
 * @param {object} options
 * @param {string} options.cwd            – working directory for the service
 * @param {string} [options.servicePath]  – service entry (defaults to the built one)
 * @param {string} [options.prettierPath] – Prettier module path (defaults to bundled)
 * @param {number} [options.timeoutMs]    – per-request timeout
 * @returns {{ request: Function, kill: Function }}
 */
function createServiceClient({
  cwd,
  servicePath = BUILT_SERVICE,
  prettierPath = BUNDLED_PRETTIER,
  timeoutMs = 30000,
}) {
  const proc = spawn('node', [servicePath, prettierPath], {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  proc.stderr.on('data', (chunk) => {
    process.stderr.write(`[service stderr] ${chunk}`)
  })

  const pending = new Map()
  let nextId = 1
  let buffer = Buffer.alloc(0)

  proc.stdout.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk])
    while (true) {
      const separator = buffer.indexOf('\r\n\r\n')
      if (separator === -1) break

      const header = buffer.slice(0, separator).toString('ascii')
      const match = /Content-Length: (\d+)/.exec(header)
      if (!match) break
      const length = parseInt(match[1], 10)

      const start = separator + 4
      if (buffer.length < start + length) break

      const body = JSON.parse(
        buffer.slice(start, start + length).toString('utf8'),
      )
      buffer = buffer.slice(start + length)

      const resolve = pending.get(body.id)
      if (resolve) {
        pending.delete(body.id)
        resolve(body)
      }
    }
  })

  function send(method, params) {
    const id = nextId++
    const frame = JSON.stringify({ jsonrpc: '2.0', id, method, params })
    const payload = Buffer.from(frame, 'utf8')
    proc.stdin.write(
      Buffer.concat([
        Buffer.from(`Content-Length: ${payload.length}\r\n\r\n`, 'ascii'),
        payload,
      ]),
    )
    return id
  }

  function request(method, params) {
    const id = send(method, params)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`Timed out waiting for response to ${method} #${id}`))
      }, timeoutMs)
      pending.set(id, (message) => {
        clearTimeout(timer)
        if (message.error) {
          reject(
            new Error(
              `${method} failed: ${message.error.message ?? JSON.stringify(message.error)}`,
            ),
          )
          return
        }
        resolve(message.result)
      })
    })
  }

  /**
   * Like request(), but resolves with the raw result even when the service
   * returned a structured `{ error }` payload (format() never throws — it
   * embeds errors in the result).
   */
  function requestRaw(method, params) {
    const id = send(method, params)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`Timed out waiting for response to ${method} #${id}`))
      }, timeoutMs)
      pending.set(id, (message) => {
        clearTimeout(timer)
        resolve(message.result ?? message.error ?? null)
      })
    })
  }

  function kill() {
    return new Promise((resolve) => {
      proc.once('exit', resolve)
      proc.kill('SIGTERM')
      setTimeout(() => {
        if (proc.exitCode === null) proc.kill('SIGKILL')
        resolve()
      }, 2000)
    })
  }

  function waitForStart() {
    return new Promise((resolve, reject) => {
      let buffer2 = Buffer.alloc(0)
      const onData = (chunk) => {
        buffer2 = Buffer.concat([buffer2, chunk])
        if (buffer2.toString('utf8').includes('didStart')) {
          proc.stdout.off('data', onData)
          resolve()
        }
      }
      proc.stdout.on('data', onData)
      const timer = setTimeout(
        () => reject(new Error('Service did not signal didStart in time')),
        timeoutMs,
      )
      proc.once('exit', (code) => {
        clearTimeout(timer)
        reject(new Error(`Service exited before starting (code ${code})`))
      })
      // The main data handler also consumes stdout; once it is attached
      // (on first request) frames flow to both. didStart arrives before
      // any response, so peeking the same stream is safe.
    })
  }

  return { proc, request, requestRaw, waitForStart, kill }
}

module.exports = {
  ROOT,
  BUILT_SERVICE,
  BUNDLED_PRETTIER,
  requireBuiltArtifacts,
  createServiceClient,
}
