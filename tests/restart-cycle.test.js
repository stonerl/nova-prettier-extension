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
 * dropped (resolution requests always run a cycle), and that redundant
 * triggers — healthy service, unchanged module path — skip the
 * stop/start instead of bouncing a freshly started service.
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

global.IssueCollection = class IssueCollection {
  clear() {}
}

// Minimal Nova shims — helpers.js reads config through these during the
// restart cycle. Everything returns null/undefined (default settings).
global.nova = {
  inDevMode: () => false,
  version: [10, 0, 0],
  versionString: '10.0',
  config: { get: () => null },
  workspace: { config: { get: () => null }, path: null },
  // main.js now loads plugin-registry.js at the top, which joins
  // plugin paths onto nova.extension.path at module load.
  path: {
    join: (...parts) => parts.filter((p) => p != null).join('/'),
  },
  extension: { path: '/tmp/fake-extension', version: '0.0.0' },
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
 * The restart debouncers are shortened to 30ms so the trailing cycle's
 * debounce delay doesn't dominate the test runtime; the logic under
 * test is the join/re-run bookkeeping, not the debounce duration.
 * Counters live outside makeInstance: main.js holds a reference to the
 * first FakeFormatter class it required, so per-instance fields would
 * not survive across tests.
 */
const calls = {
  waitForPendingFormats: 0,
  stop: 0,
  start: 0,
  resolve: 0,
}
const state = { stopGate: null, resolveResult: '/fake/prettier' }

function resetStubs() {
  for (const key of Object.keys(calls)) calls[key] = 0
  state.stopGate = null
  state.resolveResult = '/fake/prettier'
}

function makeInstance() {
  resetStubs()

  stubModule('module-resolver.js', {
    findPrettier: async () => {
      calls.resolve++
      return state.resolveResult
    },
  })

  stubModule('notifications.js', {
    showNotification: async () => 'ok',
  })

  class FakeFormatter {
    constructor() {
      this._restarting = false
      this._service = null
      this.runningPath = null
    }
    isRunning() {
      return !!this._service
    }
    async waitForPendingFormats() {
      calls.waitForPendingFormats++
    }
    async stop() {
      calls.stop++
      this._service = null
      if (state.stopGate) await state.stopGate.promise
    }
    async start(path) {
      calls.start++
      this._service = {}
      // mirror the real Formatter's contract: runningPath is recorded
      // after a successful start
      this.runningPath = path
    }
    setPlannedRestart(active) {
      this._restarting = active
    }
    dispose() {
      this._disposed = true
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

  // The trailing cycle goes through the shortened debouncer (30ms). The
  // mid-cycle trigger's resolution request was consumed by the first
  // cycle's startFormatter (it ran after the trigger set the flag), so
  // the trailing cycle skips the stop/start instead of bouncing a
  // freshly started service. The trigger was honored — by the extra
  // resolution inside the first cycle.
  await sleep(150)
  check(
    'trailing cycle skipped the stop/start (trigger resolved in-cycle)',
    calls.stop === 1 && calls.start === 1 && calls.resolve === 2,
    calls,
  )
  check(
    'pending resolution flag consumed by the first cycle',
    ext._needsResolution === false,
    ext._needsResolution,
  )

  // The regression this suite guards: a trigger that arrives after the
  // cycle's resolution must not be dropped. A fresh resolution request
  // resolving to a NEW path still runs a full cycle.
  state.resolveResult = '/fake/prettier-2'
  ext._needsResolution = true
  await ext._runRestartCycle()
  check(
    'resolution to a changed path still triggers a full cycle',
    calls.stop === 2 &&
      calls.start === 2 &&
      calls.resolve === 3 &&
      ext.formatter.runningPath === '/fake/prettier-2',
    calls,
  )
}

async function samePathResolutionSkipsBounce() {
  console.log('\n== Resolution to the same path skips the bounce ==')
  const { ext, calls } = makeInstance()

  await ext._runRestartCycle()
  check('initial cycle ran', calls.stop === 1 && calls.start === 1, calls)

  // A watched file was saved: trigger with a fresh resolution that
  // yields the same path. The service must not bounce — formatting
  // keeps working while the resolution runs.
  ext._needsResolution = true
  await ext._runRestartCycle()

  check(
    'same-path resolution did not bounce the service',
    calls.stop === 1 && calls.start === 1 && calls.resolve === 2,
    calls,
  )
}

async function modulePathConfigChangeBouncesWithoutResolution() {
  console.log('\n== Explicit module path change bounces without resolution ==')
  const { ext, calls } = makeInstance()

  await ext._runRestartCycle()
  check('initial cycle ran', calls.stop === 1 && calls.start === 1, calls)

  // The user configures an explicit module path — the observer fires
  // the fast debouncer; the effective path differs from the running
  // one, so the service must bounce WITHOUT running a resolution.
  global.nova.workspace.config.get = (name) =>
    name === 'prettier.module.path' ? '/fake/configured-prettier' : null

  try {
    await ext._runRestartCycle()
  } finally {
    global.nova.workspace.config.get = (_name) => null
  }

  check(
    'module path config change bounced the service',
    calls.stop === 2 && calls.start === 2,
    calls,
  )
  check(
    'no resolution ran for an explicit module path',
    calls.resolve === 1,
    calls,
  )
  check(
    'service now runs the configured path',
    ext.formatter.runningPath === '/fake/configured-prettier',
    ext.formatter.runningPath,
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

async function redundantTriggerSkipsRestart() {
  console.log('\n== Redundant triggers skip the stop/start ==')
  const { ext, calls } = makeInstance()

  await ext._runRestartCycle()
  check('initial cycle ran', calls.stop === 1 && calls.start === 1, calls)
  check(
    'running module path recorded',
    ext.formatter.runningPath === '/fake/prettier',
    ext.formatter.runningPath,
  )

  // A trigger with no resolution request, healthy service and unchanged
  // path (simulates Nova re-notifying config observers with unchanged
  // values during startup) must not bounce the service.
  await ext._runRestartCycle()

  check(
    'redundant trigger skipped the stop',
    calls.stop === 1 && calls.start === 1,
    calls,
  )
}

async function forceRestartOverridesSkip() {
  console.log('\n== Config reload forces a restart ==')
  const { ext, calls } = makeInstance()

  await ext._runRestartCycle()
  check('initial cycle ran', calls.stop === 1 && calls.start === 1, calls)

  ext._forceRestart = true
  await ext._runRestartCycle()

  check(
    'config reload restarted the service despite unchanged path',
    calls.stop === 2 && calls.start === 2,
    calls,
  )
  check(
    'force-restart flag consumed by the cycle',
    ext._forceRestart === false,
    ext._forceRestart,
  )
}

async function deadServiceNeverSkips() {
  console.log('\n== A dead service always restarts ==')
  const { ext, calls } = makeInstance()

  await ext._runRestartCycle()
  check('initial cycle ran', calls.stop === 1 && calls.start === 1, calls)

  // Simulate the service dying (formatter nulls its process handle).
  ext.formatter._service = null

  await ext._runRestartCycle()

  check(
    'dead service restarted without a resolution request',
    calls.stop === 2 && calls.start === 2,
    calls,
  )
}

async function main() {
  await joinDuringRunningCycleSchedulesTrailingCycle()
  await noJoinMeansNoTrailingCycle()
  await samePathResolutionSkipsBounce()
  await redundantTriggerSkipsRestart()
  await forceRestartOverridesSkip()
  await deadServiceNeverSkips()
  await modulePathConfigChangeBouncesWithoutResolution()

  console.log(
    `\n${failed === 0 ? 'All checks passed.' : `${failed} check(s) failed.`}`,
  )
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
