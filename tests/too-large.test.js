/**
 * too-large.test.js — Unit tests for the document/response size limits
 * and their user feedback, added after a file one byte over the limit
 * was announced as "32.0 MiB exceeds the 32 MiB limit".
 *
 * @license MIT
 * @author Toni Förster
 * @copyright © 2026 Toni Förster
 *
 * Plain Node script — no test framework. Exits non-zero on failure.
 *
 * Verifies that
 *   • notifyFileTooLarge and notifyResultTooLarge render number-free
 *     copy — no digit ever reaches the notification body (the rounding
 *     regression guard),
 *   • the char pre-filter fires for documents above 32 Mi chars before
 *     any text is materialized,
 *   • the UTF-8 byte guard fires for multibyte documents that slip the
 *     char filter,
 *   • the transport guard measures the actual JSON.stringify'd request
 *     and rejects quote-dense payloads whose escaping blows the frame
 *     budget even though their raw bytes are within limits,
 *   • an exactly-33,554,432-byte document formats (strict > guards)
 *     and one byte over is rejected by the byte guard,
 *   • the result-too-large service error surfaces as its own
 *     notification,
 *   • in-flight format requests settle when the service exits (no
 *     timer — the exit event does the rejecting).
 *
 * Stubs global.nova and the Nova globals, busting the require cache
 * between scenarios so module-level dedup state resets.
 */

const path = require('path')
const fs = require('fs')

const SRC_DIR = fs.realpathSync(
  process.env.TOO_LARGE_SRC || path.join(__dirname, '..', 'src', 'Scripts'),
)

let failed = 0
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`)
  if (!ok) {
    failed++
    if (detail !== undefined) {
      console.log(` → ${JSON.stringify(detail, null, 2).slice(0, 500)}`)
    }
  }
}

const EXT = '/ext'
const WORKSPACE = '/Users/tester/project'
const MAX_FILE_SIZE = 32 * 1024 * 1024 // mirrors formatter.js

function makeNovaShim() {
  const posted = []
  const get = () => null
  return {
    inDevMode: () => false,
    config: { get },
    workspace: { config: { get }, path: WORKSPACE },
    extension: { path: EXT, version: '3.9.26' },
    path: {
      isAbsolute: (p) => typeof p === 'string' && p.startsWith('/'),
      join: (...parts) => parts.filter((p) => p != null).join('/'),
      dirname: (p) => p.split('/').slice(0, -1).join('/') || '/',
    },
    localize: (_key, fallback) => fallback,
    fs: { stat: () => null },
    notifications: {
      add: async (request) => {
        posted.push(request)
        return {}
      },
      cancel: () => {},
    },
    _posted: posted,
  }
}

class Range {
  constructor(start, end) {
    this.start = start
    this.end = end
  }
}

function loadModules(shim) {
  global.nova = shim
  global.IssueCollection = class IssueCollection {
    clear() {}
  }
  global.NotificationRequest = class NotificationRequest {
    constructor(id) {
      this.id = id
    }
  }
  global.Issue = class Issue {
    constructor() {
      this.severity = null
      this.message = null
      this.line = null
      this.column = null
    }
  }
  global.IssueSeverity = { Error: 'error' }
  global.Range = Range

  for (const file of [
    'helpers.js',
    'env/processes.js',
    'env/runtime.js',
    'notifications.js',
    'settings/prettier-config.js',
    'format/plugin-registry.js',
    'format/format-request.js',
    'format/format-feedback.js',
    'format/syntax.js',
    'format/sql.js',
    'format/formatter.js',
  ]) {
    delete require.cache[path.join(SRC_DIR, file)]
  }

  return {
    feedback: require(path.join(SRC_DIR, 'format/format-feedback.js')),
    formatter: require(path.join(SRC_DIR, 'format/formatter.js')),
  }
}

function makeEditor(text, { documentLength = text.length } = {}) {
  return {
    document: {
      path: '/doc.json',
      uri: '/doc.json',
      syntax: 'javascript',
      length: documentLength,
      isRemote: false,
    },
    selectedRange: new Range(0, 0),
    selectedRanges: [new Range(0, 0)],
    getTextInRangeCalls: 0,
    getTextInRange: function (range) {
      this.getTextInRangeCalls++
      return range.start === 0 && range.end === documentLength ? text : ''
    },
    edit: async (fn) => fn({ replace: () => {} }),
    scrollToPosition: () => {},
  }
}

function makeFormatter(modules) {
  const { Formatter } = modules.formatter
  const fmt = Object.create(Formatter.prototype)
  fmt._disposed = false
  fmt._latestRequestIds = new Map()
  fmt._pendingFormats = new Set()
  fmt._exitRejectors = new Set()
  fmt._lastFailure = null
  fmt._lastFailureIsSpecific = false
  fmt._lastLoadedPlugins = []
  fmt._lastUnresolvedPlugins = []
  fmt._lastDisabledPlugins = []
  fmt.prettierServiceCrashedRecently = false
  fmt.runningPath = null
  fmt.setupIsReadyPromise()
  fmt._resolveIsReadyPromise(true)
  return fmt
}

/**
 * Fake service. `formatImpl` decides what each 'format' request does.
 */
function makeService(formatImpl) {
  const calls = []
  return {
    request: (method, params) => {
      calls.push({ method, params })
      if (method === 'hasConfig') return Promise.resolve(false)
      if (method === 'format') return formatImpl(params)
      return Promise.resolve(null)
    },
    _calls: calls,
  }
}

const FORMAT_RESULT = {
  formatted: 'formatted',
  error: null,
  ignored: false,
  missingParser: false,
  cursorOffset: 0,
  loadedPlugins: [],
  unresolvedPlugins: [],
  disabledPlugins: [],
  configFile: null,
  configError: null,
}

function notificationBodies(shim) {
  return shim._posted.map((n) => `${n.title}\n${n.body}`)
}

async function notificationRendering() {
  console.log('\n== notifications render number-free ==')

  const shim = makeNovaShim()
  const { feedback } = loadModules(shim)

  feedback.notifyFileTooLarge(33554433)
  feedback.notifyFileTooLarge(33554432)
  feedback.notifyResultTooLarge(123456)

  const bodies = notificationBodies(shim)
  check('three notifications posted', shim._posted.length === 3, shim._posted)
  check(
    'too-large title kept, result title distinct',
    shim._posted[0].title === 'Document Too Large' &&
      shim._posted[2].title === 'Result Too Large',
    shim._posted.map((n) => n.title),
  )
  check(
    'no digit ever reaches a body (rounding regression guard)',
    bodies.every((body) => !/\d/.test(body)),
    bodies,
  )
  check(
    'bodies name the size limit in words',
    bodies.every((body) => body.toLowerCase().includes('size limit')),
    bodies,
  )
  check(
    'distinct notification ids',
    shim._posted[0].id === 'prettier-file-too-large' &&
      shim._posted[2].id === 'prettier-result-too-large',
    shim._posted.map((n) => n.id),
  )
}

async function guardStack() {
  console.log('\n== guard stack: char → bytes → transport ==')

  // 1. char pre-filter fires before the text is materialized.
  {
    const shim = makeNovaShim()
    const modules = loadModules(shim)
    const { Formatter } = modules.formatter
    const fmt = makeFormatter(modules)
    const editor = makeEditor('x', { documentLength: MAX_FILE_SIZE + 1 })
    const issues = await Formatter.prototype.formatEditor.call(
      fmt,
      editor,
      false,
      false,
      {},
    )
    check(
      'char guard: notification posted, no text materialized, no request',
      shim._posted.length === 1 &&
        shim._posted[0].title === 'Document Too Large' &&
        editor.getTextInRangeCalls === 0 &&
        issues?.length === 0,
      {
        posted: shim._posted.length,
        textReads: editor.getTextInRangeCalls,
        issues: issues?.length,
      },
    )
  }

  // 2. byte guard: multibyte doc slips the char filter, blown by bytes.
  {
    const shim = makeNovaShim()
    const modules = loadModules(shim)
    const { Formatter } = modules.formatter
    const fmt = makeFormatter(modules)
    const text = '€'.repeat(11_500_000) // ~34.6 MB utf8, 11.5M chars
    const editor = makeEditor(text)
    const service = makeService(() => Promise.resolve(FORMAT_RESULT))
    fmt.prettierService = service
    const issues = await Formatter.prototype.formatEditor.call(
      fmt,
      editor,
      false,
      false,
      {},
    )
    check(
      'byte guard: notification, format never requested',
      shim._posted.length === 1 &&
        shim._posted[0].title === 'Document Too Large' &&
        service._calls.filter((c) => c.method === 'format').length === 0 &&
        issues?.length === 0,
      {
        posted: shim._posted.length,
        calls: service._calls.map((c) => c.method),
      },
    )
  }

  // 3. transport guard: quote-dense doc — raw bytes within limits,
  // escaping blows the frame budget.
  {
    const shim = makeNovaShim()
    const modules = loadModules(shim)
    const { Formatter } = modules.formatter
    const fmt = makeFormatter(modules)
    const text = '"'.repeat(21_600_000) // raw 21.6 MB, escaped 43.2 MB
    const editor = makeEditor(text)
    const service = makeService(() => Promise.resolve(FORMAT_RESULT))
    fmt.prettierService = service
    const issues = await Formatter.prototype.formatEditor.call(
      fmt,
      editor,
      false,
      false,
      {},
    )
    check(
      'transport guard: escaping-aware rejection, format never requested',
      shim._posted.length === 1 &&
        shim._posted[0].title === 'Document Too Large' &&
        service._calls.filter((c) => c.method === 'format').length === 0 &&
        issues?.length === 0,
      {
        posted: shim._posted.length,
        calls: service._calls.map((c) => c.method),
      },
    )
  }

  // 4. a comfortably-within-limits document formats normally.
  {
    const shim = makeNovaShim()
    const modules = loadModules(shim)
    const { Formatter } = modules.formatter
    const fmt = makeFormatter(modules)
    const text = 'x'.repeat(30_000_000)
    const editor = makeEditor(text)
    const service = makeService(() => Promise.resolve(FORMAT_RESULT))
    fmt.prettierService = service
    const issues =
      (await Formatter.prototype.formatEditor.call(
        fmt,
        editor,
        false,
        false,
        {},
      )) ?? []
    check(
      'within-limits document formats normally',
      shim._posted.length === 0 &&
        service._calls.filter((c) => c.method === 'format').length === 1 &&
        issues?.length === 0,
      {
        posted: shim._posted.length,
        calls: service._calls.map((c) => c.method),
      },
    )
  }

  // 5. exact boundary: exactly 33,554,432 UTF-8 bytes passes both raw
  // guards (strict >) and formats. Built as a multibyte mix so the
  // byte guard's boundary is pinned, not just the char guard's.
  {
    const shim = makeNovaShim()
    const modules = loadModules(shim)
    const { Formatter } = modules.formatter
    const fmt = makeFormatter(modules)
    const text = '€'.repeat(11_184_810) + 'xx' // 33,554,432 bytes, 11,184,812 chars
    const editor = makeEditor(text)
    const service = makeService(() => Promise.resolve(FORMAT_RESULT))
    fmt.prettierService = service
    const issues =
      (await Formatter.prototype.formatEditor.call(
        fmt,
        editor,
        false,
        false,
        {},
      )) ?? []
    check(
      'exactly 33,554,432 bytes formats (strict > on both guards)',
      shim._posted.length === 0 &&
        service._calls.filter((c) => c.method === 'format').length === 1 &&
        issues?.length === 0,
      {
        posted: shim._posted.length,
        calls: service._calls.map((c) => c.method),
      },
    )
  }

  // 6. one byte over the boundary: still under the char guard, so the
  // byte guard's strict > must reject this.
  {
    const shim = makeNovaShim()
    const modules = loadModules(shim)
    const { Formatter } = modules.formatter
    const fmt = makeFormatter(modules)
    const text = '€'.repeat(11_184_810) + 'xxx' // 33,554,433 bytes
    const editor = makeEditor(text)
    const service = makeService(() => Promise.resolve(FORMAT_RESULT))
    fmt.prettierService = service
    const issues = await Formatter.prototype.formatEditor.call(
      fmt,
      editor,
      false,
      false,
      {},
    )
    check(
      '33,554,433 bytes rejected by the byte guard, no request',
      shim._posted.length === 1 &&
        shim._posted[0].title === 'Document Too Large' &&
        service._calls.filter((c) => c.method === 'format').length === 0 &&
        issues?.length === 0,
      {
        posted: shim._posted.length,
        calls: service._calls.map((c) => c.method),
      },
    )
  }
}

async function resultTooLargeSurfaces() {
  console.log('\n== service result-too-large error surfaces ==')

  const shim = makeNovaShim()
  const modules = loadModules(shim)
  const { Formatter } = modules.formatter
  const fmt = makeFormatter(modules)
  const editor = makeEditor('x'.repeat(1000))
  const err = new Error('Formatted result too large to transmit')
  err.data = 45_000_000
  const service = makeService(() => Promise.reject(err))
  fmt.prettierService = service

  const issues = await Formatter.prototype.formatEditor.call(
    fmt,
    editor,
    false,
    false,
    {},
  )

  check(
    'result-too-large notification posted, format errors stay silent',
    shim._posted.length === 1 &&
      shim._posted[0].title === 'Result Too Large' &&
      issues?.length === 0,
    shim._posted,
  )
  check(
    'result body is number-free too',
    !/\d/.test(`${shim._posted[0].title}\n${shim._posted[0].body}`),
    shim._posted[0],
  )
}

async function exitRaceSettlesRequests() {
  console.log('\n== service exit settles in-flight requests ==')

  const shim = makeNovaShim()
  const modules = loadModules(shim)
  const { Formatter } = modules.formatter
  const fmt = makeFormatter(modules)
  const editor = makeEditor('x'.repeat(1000))
  const service = makeService(() => new Promise(() => {})) // never settles
  fmt.prettierService = service

  const started = Date.now()
  const formatPromise = Formatter.prototype.formatEditor.call(
    fmt,
    editor,
    false,
    false,
    {},
  )
  await new Promise((resolve) => setTimeout(resolve, 50))
  check('request in flight', fmt._pendingFormats.size === 1)

  fmt.prettierServiceDidExit(1)

  const issues = await Promise.race([
    formatPromise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('formatEditor still pending')), 2000),
    ),
  ])

  check(
    'formatEditor resolves promptly after exit (no dangle)',
    Date.now() - started < 2000 && issues?.length === 0,
    { elapsed: Date.now() - started, issues: issues?.length },
  )
  check(
    'pending bookkeeping cleaned up',
    fmt._pendingFormats.size === 0 && fmt._exitRejectors.size === 0,
    { pending: fmt._pendingFormats.size, rejectors: fmt._exitRejectors.size },
  )
}

async function main() {
  await notificationRendering()
  await guardStack()
  await resultTooLargeSurfaces()
  await exitRaceSettlesRequests()

  console.log(
    `\n${failed === 0 ? 'All checks passed.' : `${failed} check(s) failed.`}`,
  )
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
