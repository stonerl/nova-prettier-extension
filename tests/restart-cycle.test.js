/**
 * restart-cycle.test.js — Unit tests for PrettierExtension._runRestartCycle
 *
 * @license MIT
 * @author Toni Förster
 * @copyright © 2026 Toni Förster
 *
 * Plain Node script — no test framework. Exits non-zero on failure.
 *
 * Verifies that a trigger joining an in-flight restart cycle is not
 * dropped: after the running cycle finishes, exactly one more cycle
 * must run (regression for trailing-trigger coalescing).
 *
 * Stubs module-resolver.js, formatter.js and notifications.js via the
 * require cache before loading main.js, so no Nova APIs, npm or
 * processes are involved.
 */

const path = require('path')
const fs = require('fs')
const Module = require('module')

// realpathSync is required: Node keys require.cache by the realpath'd
// filename, so stub keys must match what Node resolves.
const SRC_DIR = fs.realpathSync(
  process.env.RESTART_CYCLE_SRC || path.join(__dirname, '..', 'src', 'Scripts'),
)
const MAIN = path.join(SRC_DIR, 'main.js')

global.IssueCollection = class IssueCollection {}

// Minimal Nova shims — helpers.js reads config through these during the
// restart cycle. Everything returns null/undefined (default settings).
global.nova = {
  inDevMode: () => false,
  version: [10, 0, 0],
  versionString: '10.0',
  config: { get: () => null },
  workspace: { config: { get: () => null }, path: null },
}

let failed = 0
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`)
  if (!ok) {
    failed++
    if (detail !== undefined) {
      console.log(` → ${JSON.stringify(detail).slice(0, 500)}`)
    }
  }
}

/**
 * Replace a module's entry in the require cache with a fake export.
 * Must run before main.js is first required.
 */
function stubModule(file, exportsObj) {
  const resolved = path.join(SRC_DIR, file)
  const m = new Module(resolved, null)
  m.exports = exportsObj
  m.loaded = true
  require.cache[resolved] = m
}

/**
 * Deferred gate — blocks an awaited promise until released.
 */
function makeGate() {
  let release
  const promise = new Promise((resolve) => {
    release = resolve
  })
  return { promise, release: () => release() }
}

async function waitFor(cond, ms = 2000, step = 5) {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > ms) {
      throw new Error(`waitFor timed out after ${ms}ms`)
    }
    await new Promise((resolve) => setTimeout(resolve, step))
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Build a fresh PrettierExtension instance backed by counting stubs.
 * The restart debouncers are shortened to 30ms so the trailing
 * cycle's debounce delay doesn't dominate the test runtime; the logic
 * under test is the join/re-run bookkeeping, not the debounce
 * duration.
 */
/**
 * Counters shared by all stub instances. main.js holds a reference to
 * the first FakeFormatter class it required, so the counters must live
 * outside makeInstance to survive across tests.
 */
const calls = {
  waitForPendingFormats: 0,
  stop: 0,
  start: 0,
  resolve: 0,
}
const state = { stopGate: null }

function resetStubs() {
  for (const key of Object.keys(calls)) calls[key] = 0
  state.stopGate = null
}

function makeInstance() {
  resetStubs()

  stubModule('module-resolver.js', async () => {
    calls.resolve++
    return '/fake/prettier'
  })

  stubModule('notifications.js', {
    showNotification: async () => 'ok',
  })

  class FakeFormatter {
    constructor() {
      this._restarting = false
    }
    async waitForPendingFormats() {
      calls.waitForPendingFormats++
    }
    async stop() {
      calls.stop++
      if (state.stopGate) await state.stopGate.promise
    }
    async start() {
      calls.start++
    }
  }

  stubModule('formatter.js', { Formatter: FakeFormatter })

  const { PrettierExtension } = require(MAIN)
  const { debouncePromise } = require(path.join(SRC_DIR, 'helpers.js'))

  const ext = new PrettierExtension()
  ext.debouncedModulePathDidChange = debouncePromise(
    ext.modulePathDidChange,
    30,
  )
  ext.debouncedModulePathOrPreferBundledDidChangeFast =
    ext.debouncedModulePathDidChange
  ext.debouncedReloadPrettierOnConfigChange = ext.debouncedModulePathDidChange

  return { ext, calls, state }
}

async function joinDuringRunningCycleSchedulesTrailingCycle() {
  console.log('\n== Trailing trigger joined mid-cycle must re-run ==')
  const { ext, calls, state } = makeInstance()

  // Keep the first cycle's stop() open so a trigger can arrive while
  // the cycle is still in flight (simulates a slow npm install).
  const gate = makeGate()
  state.stopGate = gate

  const cycle1 = ext._runRestartCycle()
  await waitFor(() => calls.stop === 1)

  // package.json changed mid-cycle: the watcher marks a fresh
  // resolution as needed, then the debounced trigger joins the cycle.
  ext._needsResolution = true
  const cycle2 = ext._runRestartCycle()

  check(
    'joining trigger returns the in-flight cycle promise',
    cycle2 === cycle1,
  )
  check('join marks the cycle as queued', ext._restartCycleQueued === true)

  gate.release()
  await cycle1
  check('first cycle finished', calls.stop === 1, calls)

  // The trailing cycle goes through the shortened debouncer (30ms).
  await waitFor(
    () =>
      calls.stop === 2 &&
      ext._restartCycle === null &&
      !ext._restartCycleQueued,
  )

  check('trailing cycle ran (second stop/start)', calls.stop === 2, calls)
  check('trailing cycle started the service again', calls.start === 2, calls)
  check(
    'pending resolution flag consumed by a cycle',
    ext._needsResolution === false,
    ext._needsResolution,
  )
}

async function noJoinMeansNoTrailingCycle() {
  console.log('\n== Cycle without joins must not schedule an extra run ==')
  const { ext, calls } = makeInstance()

  await ext._runRestartCycle()
  check('cycle completed once', calls.stop === 1, calls)
  check(
    'queued flag cleared after clean cycle',
    ext._restartCycleQueued === false,
    ext._restartCycleQueued,
  )

  // Longer than the shortened debounce delay — nothing may fire.
  await sleep(120)
  check('no extra cycle without a join', calls.stop === 1, calls)
}

async function main() {
  await joinDuringRunningCycleSchedulesTrailingCycle()
  await noJoinMeansNoTrailingCycle()

  console.log(
    `\n${failed === 0 ? 'All checks passed.' : `${failed} check(s) failed.`}`,
  )
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
