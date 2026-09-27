/**
 * notifications.test.js — Unit tests for the failure-reason notification
 * helpers (notifications.js) and the _lastFailure lifecycle they feed
 * (formatter.js), added to explain why Prettier failed to start.
 *
 * @license MIT
 * @author Toni Förster
 * @copyright © 2026 Toni Förster
 *
 * Plain Node script — no test framework. Exits non-zero on failure.
 *
 * Verifies that
 *   • describeFailure maps known failure modes to plain-language
 *     reasons: missing module (workspace-relative path), process
 *     timeouts (both message styles, ms → seconds), startup exits, and
 *     falls back to the first message line with an Error: prefix strip
 *     and a length cap,
 *   • withReason leaves bodies unchanged when there is no reason and
 *     appends a localized "Reason:" line otherwise,
 *   • Formatter._lastFailure is recorded by didCrash and unexpected
 *     exits, preserved when a more specific reason already exists, not
 *     recorded for clean exits, and reaches the "Prettier Stopped
 *     Running" notification as a Reason: line.
 *
 * The Formatter lifecycle tests run against Formatter.prototype with
 * only the fields the methods touch — no service process, no start().
 */

const path = require('path')
const fs = require('fs')

const SRC_DIR = fs.realpathSync(
  process.env.NOTIFICATIONS_SRC || path.join(__dirname, '..', 'src', 'Scripts'),
)

let failed = 0
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`)
  if (!ok) {
    failed++
    if (detail !== undefined) {
      console.log(` → ${JSON.stringify(detail, null, 2).slice(0, 800)}`)
    }
  }
}

const WORKSPACE = '/Users/tester/project'
const EXTENSION = '/tmp/nova-ext/prettier-extension'

/**
 * Nova shim: localize returns the fallback so assertions match the
 * English fallbacks; notifications.post captures posted requests.
 */
function makeNovaShim() {
  const posted = []
  return {
    inDevMode: () => false,
    version: [14, 0, 0],
    versionString: '14.0',
    environment: { HOME: '/Users/tester', PATH: '/usr/bin:/bin' },
    config: { get: () => null },
    workspace: { config: { get: () => null }, path: WORKSPACE },
    extension: { path: EXTENSION },
    localize: (key, value) => value ?? key,
    notifications: {
      add: (request) => {
        posted.push(request)
        return Promise.resolve(undefined)
      },
      cancel: () => {},
    },
    path: {
      isAbsolute: (p) => p.startsWith('/'),
      join: (...parts) => parts.filter((p) => p != null).join('/'),
      dirname: (p) => p.split('/').slice(0, -1).join('/') || '/',
    },
    _posted: posted,
  }
}

function loadNotifications(novaShim) {
  global.nova = novaShim
  global.IssueCollection = class IssueCollection {}
  global.NotificationRequest = class NotificationRequest {
    constructor(id) {
      this.id = id
    }
  }

  for (const file of ['notifications.js']) {
    delete require.cache[path.join(SRC_DIR, file)]
  }
  return require(path.join(SRC_DIR, 'notifications.js'))
}

function loadFormatter(novaShim) {
  global.nova = novaShim
  global.NotificationRequest = class NotificationRequest {
    constructor(id) {
      this.id = id
    }
  }

  for (const file of [
    'helpers.js',
    'notifications.js',
    'prettier-plugins.js',
    'formatter.js',
  ]) {
    delete require.cache[path.join(SRC_DIR, file)]
  }
  const { Formatter } = require(path.join(SRC_DIR, 'formatter.js'))
  return Formatter
}

function describeFailureCases() {
  console.log('\n== describeFailure ==')

  const { describeFailure } = loadNotifications(makeNovaShim())

  const missing = describeFailure(
    new Error(
      "Cannot find module '/Users/tester/project/node_modules/prettier'",
    ),
  )
  check(
    'missing module → plain-language reason with workspace-relative path',
    missing ===
      'Prettier could not be loaded from node_modules/prettier. The installation may be incomplete — try reinstalling your project’s dependencies.',
    missing,
  )

  const helpersTimeout = describeFailure(
    new Error('Process timed out after 30000ms'),
  )
  check(
    'helpers-style timeout → seconds rounded',
    helpersTimeout ===
      'A Node.js process didn’t respond within 30 seconds. Your Mac may be under heavy load — try restarting Prettier once it settles.',
    helpersTimeout,
  )

  const startupTimeout = describeFailure(
    new Error('Prettier service did not signal startup within 10000ms'),
  )
  check(
    'startup-style timeout → seconds rounded',
    startupTimeout.includes('within 10 seconds'),
    startupTimeout,
  )

  const exited = describeFailure(
    new Error('Prettier service exited before starting (exit code 1)'),
  )
  check(
    'startup exit → code interpolated',
    exited === 'The Prettier service exited during startup (exit code 1).',
    exited,
  )

  const fallback = describeFailure(
    new Error('Error: something specific went wrong\nstack line\nmore stack'),
  )
  check(
    'fallback → first line, Error: prefix stripped',
    fallback === 'something specific went wrong',
    fallback,
  )

  const long = 'x'.repeat(300)
  const truncated = describeFailure(new Error(long))
  check(
    'fallback → long messages truncated with ellipsis',
    truncated.length === 200 && truncated.endsWith('…'),
    truncated.length,
  )

  check('null → null', describeFailure(null) === null)
  check('empty message → null', describeFailure(new Error('   ')) === null)
}

function withReasonCases() {
  console.log('\n== withReason ==')

  const { withReason } = loadNotifications(makeNovaShim())

  const body = 'Please check the Extension Console.'
  check('no reason → body unchanged', withReason(body, null) === body)
  check('empty reason → body unchanged', withReason(body, '') === body)
  check(
    'reason → localized label appended on its own paragraph',
    withReason(body, 'it timed out') === `${body}\n\nReason: it timed out`,
    withReason(body, 'it timed out'),
  )
}

function lastFailureLifecycle() {
  console.log('\n== Formatter._lastFailure lifecycle ==')

  const Formatter = loadFormatter(makeNovaShim())

  // didCrash records the crash reason.
  const crashFmt = Object.create(Formatter.prototype)
  crashFmt.prettierServiceDidCrash({
    parameters: { name: 'TypeError', message: 'boom at line 4' },
  })
  check(
    'didCrash records name + message',
    crashFmt._lastFailure?.message === 'TypeError: boom at line 4',
    crashFmt._lastFailure,
  )

  // An unexpected exit without a prior reason records the exit code.
  const exitFmt = Object.create(Formatter.prototype)
  exitFmt.prettierService = {}
  exitFmt.start = async () => {}
  exitFmt.prettierServiceDidExit(1)
  check(
    'unexpected exit records the exit code',
    exitFmt._lastFailure?.message ===
      'Prettier service exited unexpectedly (exit code 1)',
    exitFmt._lastFailure,
  )

  // A more specific reason (didCrash) survives the exit — no clobbering.
  const preserveFmt = Object.create(Formatter.prototype)
  preserveFmt.prettierService = {}
  preserveFmt.start = async () => {}
  preserveFmt.prettierServiceDidCrash({
    parameters: { name: 'TypeError', message: 'boom at line 4' },
  })
  preserveFmt.prettierServiceDidExit(2)
  check(
    'specific reason survives an unexpected exit',
    preserveFmt._lastFailure?.message === 'TypeError: boom at line 4',
    preserveFmt._lastFailure,
  )

  // Clean stops (exit 0) must not record a bogus failure.
  const cleanFmt = Object.create(Formatter.prototype)
  cleanFmt.prettierService = {}
  cleanFmt.start = async () => {}
  cleanFmt.prettierServiceDidExit(0)
  check(
    'clean stop records no failure',
    cleanFmt._lastFailure === null || cleanFmt._lastFailure === undefined,
    cleanFmt._lastFailure,
  )
}

function reasonReachesNotification() {
  console.log('\n== failure reason reaches the notification ==')

  const novaShim = makeNovaShim()
  const Formatter = loadFormatter(novaShim)

  // crashedRecently is already set: the non-zero exit takes the
  // notification path instead of spawning a restart.
  const fmt = Object.create(Formatter.prototype)
  fmt.prettierService = {}
  fmt.start = async () => {}
  fmt.prettierServiceDidExit(1)

  // Second failure within the crash window → notification with reason.
  fmt.prettierServiceCrashedRecently = true
  fmt.prettierService = {}
  fmt.prettierServiceDidExit(3)

  const request = novaShim._posted[0]
  check('notification was posted', !!request, novaShim._posted)
  check(
    'title is the stopped-running notification',
    request?.title === 'Prettier Stopped Running',
    request?.title,
  )
  check(
    'body carries the Reason line with the exit code',
    typeof request?.body === 'string' &&
      request.body.includes('Reason:') &&
      request.body.includes('exit code 3'),
    request?.body,
  )
}

async function main() {
  describeFailureCases()
  withReasonCases()
  lastFailureLifecycle()
  reasonReachesNotification()

  console.log(
    `\n${failed === 0 ? 'All checks passed.' : `${failed} check(s) failed.`}`,
  )
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
