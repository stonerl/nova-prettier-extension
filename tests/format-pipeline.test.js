/**
 * format-pipeline.test.js — Unit tests for the format pipeline layer of
 * Prettier⁺ for Nova
 *
 * @license MIT
 * @author Toni Förster
 * @copyright © 2026 Toni Förster
 *
 * Plain Node script — no test framework. Exits non-zero on failure.
 *
 * Covers the pure functions created by the formatter split:
 *   • composeFormatRequest — bundled-plugin gating and ordering,
 *     option assembly and the SQL formatter routing protocol
 *   • prettierErrorToIssues — parser-missing notice vs issue mapping,
 *     both Prettier code-frame message forms
 *   • shouldApplyDefaultConfig — the four save gates
 *   • reportMissingBundledPlugins — report escalation and dedup
 *   • rehydrateError — the error envelope contract
 *   • applyResult — edit application and the multi-cursor guard
 *   • detectSyntax — general syntax detection (SQL has its own suite)
 *
 * Note on the SQL routing protocol: composeFormatRequest's `{ skip }`
 * dead end is defensive — every extension mapped in sql.js is
 * supported by at least one formatter, so it is unreachable through
 * real document data. The mismatch protocol IS reachable and tested.
 *
 * Stubs global.nova and the Nova globals per scenario, and busts the
 * require cache between scenarios so module-level dedup state resets.
 */

const path = require('path')
const fs = require('fs')

const SRC_DIR = fs.realpathSync(
  process.env.FORMAT_PIPELINE_SRC ||
    path.join(__dirname, '..', 'src', 'Scripts'),
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

const EXT = '/ext'
const BUNDLED_RUNNING = `${EXT}/node_modules/prettier`
const NATIVE_RUNNING = '/usr/local/lib/prettier'
const WORKSPACE = '/Users/tester/project'

/**
 * Nova shim. Config getters fall through a table; unset keys read as
 * null (Nova's unset value). Only what the touched modules read at
 * call time.
 */
function makeNovaShim({ configValues = {}, extensionPath = EXT } = {}) {
  const get = (name) =>
    Object.prototype.hasOwnProperty.call(configValues, name)
      ? configValues[name]
      : null
  return {
    inDevMode: () => false,
    config: { get },
    workspace: { config: { get }, path: WORKSPACE },
    extension: { path: extensionPath, version: '3.9.25' },
    path: {
      isAbsolute: (p) => typeof p === 'string' && p.startsWith('/'),
      join: (...parts) => parts.filter((p) => p != null).join('/'),
      dirname: (p) => p.split('/').slice(0, -1).join('/') || '/',
    },
    localize: (_key, fallback) => fallback,
    fs: {
      stat: (p) => (p.includes('prettier-plugin-ejs/index.js') ? null : {}),
    },
    notifications: {
      add: async () => ({}),
      cancel: () => {},
    },
  }
}

class Range {
  constructor(start, end) {
    this.start = start
    this.end = end
  }
}

class Issue {
  constructor() {
    this.severity = null
    this.message = null
    this.line = null
    this.column = null
  }
}

global.Issue = Issue
global.IssueSeverity = { Error: 'error' }
global.Range = Range

/**
 * Requires a fresh set of modules with the given shim. The feedback
 * module holds session-scoped dedup state, and the registry warns once
 * per path — all must reset between scenarios, so every touched module
 * is evicted.
 */
function loadModules(shim) {
  global.nova = shim

  for (const file of [
    'helpers.js',
    'env/processes.js',
    'notifications.js',
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
    formatRequest: require(path.join(SRC_DIR, 'format/format-request.js')),
    pluginRegistry: require(path.join(SRC_DIR, 'format/plugin-registry.js')),
    feedback: require(path.join(SRC_DIR, 'format/format-feedback.js')),
    syntax: require(path.join(SRC_DIR, 'format/syntax.js')),
    Formatter: require(path.join(SRC_DIR, 'format/formatter.js')).Formatter,
    processes: require(path.join(SRC_DIR, 'env/processes.js')),
  }
}

/**
 * Editor/document fakes for composeFormatRequest and applyResult.
 */
function makeEditor({
  path = '/doc.js',
  uri = path,
  syntax = 'javascript',
  selectedRange,
  selectedRanges,
  editImpl,
}) {
  return {
    document: { path, uri, syntax, length: 20, isRemote: false },
    selectedRange: selectedRange ?? new Range(0, 0),
    selectedRanges: selectedRanges ?? [selectedRange ?? new Range(0, 0)],
    getTextInRange: () => '',
    edit: editImpl ?? (async (fn) => fn({ replace: () => {} })),
    scrollToPosition: () => {},
  }
}

const compose = (m, opts) => {
  const editor = opts.editor ?? makeEditor({})
  return m.formatRequest.composeFormatRequest({
    document: editor.document,
    editor,
    syntaxKey: opts.syntaxKey,
    runningPath: opts.runningPath ?? BUNDLED_RUNNING,
    customConfigFile: opts.customConfigFile ?? null,
    ignoreConfigFile: opts.ignoreConfigFile ?? false,
    applyDefaultConfig: opts.applyDefaultConfig ?? false,
    selectionOnly: opts.selectionOnly ?? false,
  })
}

function composePluginChecks() {
  console.log('\n== composeFormatRequest: plugin gating and ordering ==')

  const m = loadModules(makeNovaShim())

  const enabledSyntax = (key) => ({
    [`prettier.plugins.prettier-plugin-${key}.enabled`]: true,
    [`prettier.plugins.prettier-plugin-tailwind.syntaxes.${key}`]: true,
  })

  // Native mode never injects bundled plugin paths — even when fully
  // enabled — because the native module loads its own plugins.
  const native = compose(
    loadModules(makeNovaShim({ configValues: enabledSyntax('sh') })),
    { syntaxKey: 'sh', runningPath: NATIVE_RUNNING },
  )
  check(
    'native mode: no plugins injected',
    (native.plugins ?? []).length === 0,
    native.plugins,
  )

  const bundled = compose(
    loadModules(makeNovaShim({ configValues: enabledSyntax('sh') })),
    { syntaxKey: 'sh' },
  )
  check(
    'bundled mode: primary plugin injected when enabled',
    bundled.plugins?.[0] === m.pluginRegistry.pluginPaths.sh,
    bundled.plugins,
  )

  const primaryDisabled = compose(
    loadModules(
      makeNovaShim({
        configValues: {
          'prettier.plugins.prettier-plugin-sh.enabled': false,
          'prettier.plugins.prettier-plugin-tailwind.syntaxes.sh': true,
          'prettier.plugins.prettier-plugin-tailwind.enabled': true,
        },
      }),
    ),
    { syntaxKey: 'sh' },
  )
  check(
    'primary plugin disabled: no primary, but tailwind still applies',
    !primaryDisabled.plugins?.includes(m.pluginRegistry.pluginPaths.sh) &&
      primaryDisabled.plugins?.[0] === m.pluginRegistry.pluginPaths.tailwind,
    primaryDisabled.plugins,
  )

  const htmlEjs = compose(
    loadModules(
      makeNovaShim({
        configValues: {
          'prettier.plugins.prettier-plugin-ejs.enabled': true,
          'prettier.plugins.prettier-plugin-tailwind.enabled': true,
          'prettier.plugins.prettier-plugin-tailwind.syntaxes.html+ejs': true,
        },
      }),
    ),
    { syntaxKey: 'html+ejs', editor: makeEditor({ path: '/doc.html.ejs' }) },
  )
  check(
    'html+ejs: ejs loads before tailwind (tailwind must be last)',
    htmlEjs.plugins?.length === 2 &&
      htmlEjs.plugins[0] === m.pluginRegistry.pluginPaths.ejs &&
      htmlEjs.plugins[1] === m.pluginRegistry.pluginPaths.tailwind,
    htmlEjs.plugins,
  )

  const htmlNoEjs = compose(
    loadModules(
      makeNovaShim({
        configValues: {
          'prettier.plugins.prettier-plugin-tailwind.enabled': true,
          'prettier.plugins.prettier-plugin-tailwind.syntaxes.html': true,
        },
      }),
    ),
    { syntaxKey: 'html', editor: makeEditor({ path: '/doc.html' }) },
  )
  check(
    'html without ejs enabled: no ejs path',
    !htmlNoEjs.plugins?.includes(m.pluginRegistry.pluginPaths.ejs),
    htmlNoEjs.plugins,
  )

  const masterOff = compose(
    loadModules(
      makeNovaShim({
        configValues: {
          'prettier.plugins.prettier-plugin-tailwind.enabled': false,
          'prettier.plugins.prettier-plugin-tailwind.syntaxes.css': true,
        },
      }),
    ),
    { syntaxKey: 'css', editor: makeEditor({ path: '/doc.css' }) },
  )
  check(
    'tailwind master flag off: no tailwind despite syntax flag',
    !masterOff.plugins?.includes(m.pluginRegistry.pluginPaths.tailwind),
    masterOff.plugins,
  )

  const syntaxOff = compose(
    loadModules(
      makeNovaShim({
        configValues: {
          'prettier.plugins.prettier-plugin-tailwind.enabled': true,
          'prettier.plugins.prettier-plugin-tailwind.syntaxes.css': false,
        },
      }),
    ),
    { syntaxKey: 'css', editor: makeEditor({ path: '/doc.css' }) },
  )
  check(
    'tailwind syntax flag off: no tailwind despite master flag',
    !syntaxOff.plugins?.includes(m.pluginRegistry.pluginPaths.tailwind),
    syntaxOff.plugins,
  )

  const bothOn = compose(
    loadModules(
      makeNovaShim({
        configValues: {
          'prettier.plugins.prettier-plugin-sh.enabled': true,
          'prettier.plugins.prettier-plugin-tailwind.enabled': true,
          'prettier.plugins.prettier-plugin-tailwind.syntaxes.sh': true,
        },
      }),
    ),
    { syntaxKey: 'sh' },
  )
  check(
    'tailwind both flags on: loaded last',
    bothOn.plugins?.[bothOn.plugins.length - 1] ===
      m.pluginRegistry.pluginPaths.tailwind,
    bothOn.plugins,
  )

  const unknown = compose(loadModules(makeNovaShim()), {
    syntaxKey: 'swift',
    runningPath: NATIVE_RUNNING,
  })
  check(
    'unknown syntax: no primary plugin, no crash',
    unknown.plugins?.length === 0,
    unknown.plugins,
  )

  const dockerfile = compose(
    loadModules(makeNovaShim({ configValues: enabledSyntax('sh') })),
    { syntaxKey: 'dockerfile', editor: makeEditor({ path: '/Dockerfile' }) },
  )
  check(
    'dockerfile maps to the sh plugin',
    dockerfile.plugins?.[0] === m.pluginRegistry.pluginPaths.sh,
    dockerfile.plugins,
  )

  const liquidMd = compose(
    loadModules(makeNovaShim({ configValues: enabledSyntax('liquid') })),
    {
      syntaxKey: 'liquid-md',
      editor: makeEditor({ path: '/doc.liquid.md' }),
    },
  )
  check(
    'liquid-md maps to the liquid plugin',
    liquidMd.plugins?.[0] === m.pluginRegistry.pluginPaths.liquid,
    liquidMd.plugins,
  )
}

function composeOptionChecks() {
  console.log('\n== composeFormatRequest: option assembly ==')

  // Custom config file: the service resolves it — nothing merged
  // client-side except the routing flags.
  const custom = compose(
    loadModules(
      makeNovaShim({
        configValues: { 'prettier.default-config.printWidth': 100 },
      }),
    ),
    { syntaxKey: 'javascript', customConfigFile: '/p/.prettierrc' },
  )
  check(
    'custom config file: no default-config merge',
    custom.options?.printWidth === undefined,
    custom.options,
  )
  check(
    'custom config file: routing flags set',
    custom.options?._customConfigFile === '/p/.prettierrc' &&
      custom.options?._ignoreConfigFile === false,
    custom.options,
  )

  const configFound = compose(
    loadModules(
      makeNovaShim({
        configValues: { 'prettier.default-config.printWidth': 100 },
      }),
    ),
    { syntaxKey: 'javascript', applyDefaultConfig: true },
  )
  check(
    'config found: default-config values assigned',
    configFound.options?.printWidth === 100,
    configFound.options,
  )

  const ignored = compose(
    loadModules(
      makeNovaShim({
        configValues: { 'prettier.default-config.printWidth': 100 },
      }),
    ),
    { syntaxKey: 'javascript', ignoreConfigFile: true },
  )
  check(
    'ignore flag: default-config values assigned',
    ignored.options?.printWidth === 100,
    ignored.options,
  )

  const nothing = compose(
    loadModules(
      makeNovaShim({
        configValues: { 'prettier.default-config.printWidth': 100 },
      }),
    ),
    { syntaxKey: 'javascript' },
  )
  check(
    'no config and no ignore: no defaults merged',
    nothing.options?.printWidth === undefined,
    nothing.options,
  )

  const selection = compose(loadModules(makeNovaShim()), {
    syntaxKey: 'javascript',
    selectionOnly: true,
    editor: makeEditor({ selectedRange: new Range(7, 42) }),
  })
  check(
    'selection only: rangeStart/rangeEnd from the selection',
    selection.options?.rangeStart === 7 && selection.options?.rangeEnd === 42,
    selection.options,
  )

  const sh = compose(
    loadModules(
      makeNovaShim({
        configValues: {
          'prettier.plugins.prettier-plugin-sh.variant': 'posix',
          'prettier.plugins.prettier-plugin-sh.enabled': true,
        },
      }),
    ),
    { syntaxKey: 'sh', applyDefaultConfig: true },
  )
  check(
    'syntax option loader applied (sh variant)',
    sh.options?.variant === 'posix',
    sh.options,
  )

  const tailwindOpts = compose(
    loadModules(
      makeNovaShim({
        configValues: {
          'prettier.plugins.prettier-plugin-tailwind.enabled': true,
          'prettier.plugins.prettier-plugin-tailwind.syntaxes.css': true,
          'prettier.plugins.prettier-plugin-tailwind.tailwindConfig':
            '/p/tailwind.config.js',
        },
      }),
    ),
    {
      syntaxKey: 'css',
      applyDefaultConfig: true,
      editor: makeEditor({ path: '/doc.css' }),
    },
  )
  check(
    'tailwind options merged on both flags',
    tailwindOpts.options?.tailwindConfig === '/p/tailwind.config.js',
    tailwindOpts.options,
  )

  // SQL routing — pinned implementations
  const sqlPinned = compose(
    loadModules(
      makeNovaShim({
        configValues: {
          'prettier.plugins.prettier-plugin-sql.formatter': 'sql-formatter',
          'prettier.plugins.prettier-plugin-sql.sql-formatter.keywordCase':
            'upper',
        },
      }),
    ),
    {
      syntaxKey: 'sql',
      applyDefaultConfig: true,
      editor: makeEditor({ path: '/schema.sql', uri: '/schema.sql' }),
    },
  )
  check(
    'sql pinned sql-formatter: option group assigned',
    sqlPinned.options?.keywordCase === 'upper',
    sqlPinned.options,
  )

  const nodePinned = compose(
    loadModules(
      makeNovaShim({
        configValues: {
          'prettier.plugins.prettier-plugin-sql.formatter': 'node-sql-parser',
          'prettier.plugins.prettier-plugin-sql.node-sql-parser.database':
            'postgresql',
        },
      }),
    ),
    {
      syntaxKey: 'sql',
      applyDefaultConfig: true,
      editor: makeEditor({ path: '/schema.sql', uri: '/schema.sql' }),
    },
  )
  check(
    'sql pinned node-sql-parser: option group assigned',
    nodePinned.options?.database === 'postgresql',
    nodePinned.options,
  )

  // Auto-detection: dialect from URI decides the implementation
  const sqlAuto = compose(
    loadModules(
      makeNovaShim({
        configValues: {
          'prettier.plugins.prettier-plugin-sql.formatter': 'auto',
          'prettier.plugins.prettier-plugin-sql.sql-formatter.keywordCase':
            'upper',
        },
      }),
    ),
    {
      syntaxKey: 'sql',
      applyDefaultConfig: true,
      editor: makeEditor({
        path: '/schema.mariadb.sql',
        uri: '/schema.mariadb.sql',
      }),
    },
  )
  check(
    'sql auto-detect: uri dialect maps to sql-formatter language',
    sqlAuto.options?.keywordCase === 'upper',
    sqlAuto.options,
  )

  // Auto + flinksql routes to node-sql-parser (sql-formatter has no
  // flinksql dialect)
  const sqlAutoFlink = compose(
    loadModules(
      makeNovaShim({
        configValues: {
          'prettier.plugins.prettier-plugin-sql.formatter': 'auto',
          'prettier.plugins.prettier-plugin-sql.node-sql-parser.type': 'table',
        },
      }),
    ),
    {
      syntaxKey: 'sql',
      applyDefaultConfig: true,
      editor: makeEditor({ path: '/mig.flinksql', uri: '/mig.flinksql' }),
    },
  )
  check(
    'sql auto-detect: flinksql routes to node-sql-parser',
    sqlAutoFlink.options?.type === 'table',
    sqlAutoFlink.options,
  )

  // Mismatch protocol: pinned sql-formatter + flinksql dialect
  const mismatchSql = compose(
    loadModules(
      makeNovaShim({
        configValues: {
          'prettier.plugins.prettier-plugin-sql.formatter': 'sql-formatter',
          'prettier.plugins.prettier-plugin-sql.sql-formatter.language': 'auto',
        },
      }),
    ),
    {
      syntaxKey: 'sql',
      applyDefaultConfig: true,
      editor: makeEditor({ path: '/mig.flinksql', uri: '/mig.flinksql' }),
    },
  )
  check(
    'sql mismatch protocol: sql-formatter vs flinksql',
    mismatchSql.mismatch?.dialect === 'flinksql' &&
      mismatchSql.mismatch?.selected === 'sql-formatter',
    mismatchSql,
  )

  // Mismatch protocol: pinned node-sql-parser + spark dialect
  const mismatchNode = compose(
    loadModules(
      makeNovaShim({
        configValues: {
          'prettier.plugins.prettier-plugin-sql.formatter': 'node-sql-parser',
          'prettier.plugins.prettier-plugin-sql.node-sql-parser.database':
            'auto',
        },
      }),
    ),
    {
      syntaxKey: 'sql',
      applyDefaultConfig: true,
      editor: makeEditor({ path: '/x.spark.sql', uri: '/x.spark.sql' }),
    },
  )
  check(
    'sql mismatch protocol: node-sql-parser vs spark',
    mismatchNode.mismatch?.dialect === 'spark' &&
      mismatchNode.mismatch?.selected === 'node-sql-parser',
    mismatchNode,
  )
}

function prettierErrorChecks() {
  console.log('\n== prettierErrorToIssues ==')

  const m = loadModules(makeNovaShim())
  const { prettierErrorToIssues } = m.feedback

  // "Couldn't resolve parser" — manual format shows the notice
  const parserError = m.processes.rehydrateError({
    name: 'UndefinedParserError',
    message: 'Couldn\'t resolve parser "swift".',
  })
  let issues
  issues = prettierErrorToIssues(parserError, false, false, '/x.swift')
  check(
    'parser-missing on manual format: notice + no issues',
    issues.length === 0,
    issues,
  )
}

function prettierErrorNoticeChecks() {
  console.log('\n== prettierErrorToIssues: notice gating ==')

  // saving: true must suppress the notice (quiet skip on save)
  const m = loadModules(makeNovaShim())
  const { prettierErrorToIssues } = m.feedback

  const parserError = m.processes.rehydrateError({
    name: 'UndefinedParserError',
    message: "Couldn't resolve parser 'swift'.",
  })
  let notified = false
  global.showNotificationSpy = async () => {
    notified = true
    return {}
  }
  // The feedback module captured showNotification from notifications.js
  // at require time — spy via the shim's notifications.add instead.
  let addCalls = 0
  global.nova.notifications.add = async () => {
    addCalls++
    return {}
  }

  prettierErrorToIssues(parserError, false, true, '/x.swift')
  check('parser-missing on save: notice suppressed', addCalls === 0, addCalls)

  const issues = prettierErrorToIssues(
    m.processes.rehydrateError({
      name: 'UndefinedParserError',
      message: "Couldn't resolve parser 'swift'.",
    }),
    true,
    true,
    '/x.swift',
  )
  check(
    'missingParser flag on save: quiet skip',
    issues.length === 0 && addCalls === 0,
    { issues, addCalls },
  )
}

function issueMappingChecks() {
  console.log('\n== issuesFromPrettierError: message forms ==')

  const m = loadModules(makeNovaShim())
  const issues = m.feedback.prettierErrorToIssues(
    m.processes.rehydrateError({
      name: 'SyntaxError',
      message: 'Unexpected token (12:5)\n  10 | code here\n',
    }),
    false,
    false,
    '/x.js',
  )
  check(
    '(line:column) form: line/column mapped',
    issues.length === 1 &&
      issues[0].line === 12 &&
      issues[0].column === 5 &&
      issues[0].severity === 'error',
    issues,
  )

  const frame = m.feedback.prettierErrorToIssues(
    m.processes.rehydrateError({
      name: 'SyntaxError',
      message: 'Unexpected token\n> 12 | const foo =\n    |            ^\n',
    }),
    false,
    false,
    '/x.js',
  )
  check(
    'code-frame form: caret line determines the column',
    frame.length === 1 && frame[0].line === 12 && frame[0].column === 13,
    frame,
  )

  const frameNoCaret = m.feedback.prettierErrorToIssues(
    m.processes.rehydrateError({
      name: 'SyntaxError',
      message: 'Unexpected token\n> 12 | const foo =\n',
    }),
    false,
    false,
    '/x.js',
  )
  check(
    'code-frame form without caret line: column 0',
    frameNoCaret.length === 1 && frameNoCaret[0].column === 0,
    frameNoCaret,
  )

  // Bare message with the stack appended — the stack is stripped so the
  // Issues UI shows the reason only.
  const withStack = m.feedback.prettierErrorToIssues(
    m.processes.rehydrateError({
      name: 'SyntaxError',
      message: 'Unexpected token (12:5)\n',
    }),
    false,
    false,
    '/x.js',
  )
  check(
    'issue message keeps the full message when a stack exists',
    withStack.length === 1 && withStack[0].message.includes('Unexpected token'),
    withStack,
  )

  // UndefinedParserError with a non-matching message rethrows (it means
  // the parser couldn't be inferred at all — generic error handling).
  let rethrown = false
  try {
    m.feedback.prettierErrorToIssues(
      m.processes.rehydrateError({
        name: 'UndefinedParserError',
        message: 'No parser could be inferred for file.',
      }),
      false,
      false,
      '/x.weird',
    )
  } catch (err) {
    rethrown = err.name === 'UndefinedParserError'
  }
  check('UndefinedParserError rethrows', rethrown)

  // No line data and no parser match → rethrow for the generic handler.
  let rethrownGeneric = false
  try {
    m.feedback.prettierErrorToIssues(
      m.processes.rehydrateError({
        name: 'Error',
        message: 'Something entirely different broke',
      }),
      false,
      false,
      '/x.js',
    )
  } catch {
    rethrownGeneric = true
  }
  check('no line data: rethrows for the generic handler', rethrownGeneric)

  const nonString = m.feedback.prettierErrorToIssues(
    m.processes.rehydrateError({ message: 42 }),
    false,
    false,
    '/x.js',
  )
  check(
    'hardening: non-string message maps to no issues',
    nonString.length === 0,
    nonString,
  )
}

async function shouldApplyDefaultConfigChecks() {
  console.log('\n== shouldApplyDefaultConfig: save gates ==')

  const m = loadModules(makeNovaShim())
  const { Formatter } = m

  const makeFmt = (configValues, service) => {
    global.nova = makeNovaShim({ configValues })
    const fmt = Object.create(Formatter.prototype)
    fmt._isReadyPromise = Promise.resolve(true)
    fmt._restarting = false
    fmt._disposed = false
    fmt.prettierService = service
    return fmt
  }

  const doc = { path: '/d.sql', isRemote: false, syntax: 'sql' }

  // Gate 1: per-syntax format-on-save ignore
  const ignoredSyntax = makeFmt(
    { 'prettier.format-on-save.ignored-syntaxes.sql': true },
    { request: async () => true },
  )
  check(
    'ignored syntax on save: null',
    (await ignoredSyntax.shouldApplyDefaultConfig(
      'sql',
      doc,
      true,
      '/d.sql',
      null,
    )) === null,
  )

  // Gate 2: remote documents
  const remote = makeFmt(
    { 'prettier.format-on-save.ignore-remote': true },
    { request: async () => true },
  )
  check(
    'remote + ignore-remote: null',
    (await remote.shouldApplyDefaultConfig(
      'sql',
      { path: null, isRemote: true },
      true,
      WORKSPACE,
      null,
    )) === null,
  )

  // Custom config file counts as config — no probe fired
  let probeCalls = 0
  const withCustom = makeFmt({}, { request: async () => (probeCalls++, true) })
  check(
    'custom config file: hasConfig assumed, no probe',
    (await withCustom.shouldApplyDefaultConfig(
      'sql',
      doc,
      true,
      '/d.sql',
      '/p/.prettierrc',
    )) === false && probeCalls === 0,
    { probeCalls },
  )

  // Gate 3: ignore-without-config
  const withoutConfig = makeFmt(
    { 'prettier.format-on-save.ignore-without-config': true },
    { request: async () => false },
  )
  check(
    'no config + ignore-without-config on save: null',
    (await withoutConfig.shouldApplyDefaultConfig(
      'sql',
      doc,
      true,
      '/d.sql',
      null,
    )) === null,
  )

  const withoutConfigOff = makeFmt(
    { 'prettier.format-on-save.ignore-without-config': false },
    { request: async () => false },
  )
  check(
    'no config on save without ignore flag: defaults apply',
    (await withoutConfigOff.shouldApplyDefaultConfig(
      'sql',
      doc,
      true,
      '/d.sql',
      null,
    )) === true,
  )

  // IPC failure of the probe — treated as no config
  const probeFails = makeFmt(
    {},
    {
      request: async () => {
        throw new Error('IPC dead')
      },
    },
  )
  check(
    'hasConfig probe failure: treated as no config',
    (await probeFails.shouldApplyDefaultConfig(
      'sql',
      doc,
      true,
      '/d.sql',
      null,
    )) === true,
  )

  // Service not ready — no probe, assumes no config
  global.nova = makeNovaShim({})
  const notReady = Object.create(Formatter.prototype)
  notReady._isReadyPromise = null
  notReady._restarting = true
  notReady.prettierService = null
  check(
    'service not ready: assumes no config',
    (await notReady.shouldApplyDefaultConfig(
      'sql',
      doc,
      true,
      '/d.sql',
      null,
    )) === true,
  )

  // Config found via probe
  const probeSays = makeFmt({}, { request: async () => true })
  check(
    'config found via probe: no defaults',
    (await probeSays.shouldApplyDefaultConfig(
      'sql',
      doc,
      true,
      '/d.sql',
      null,
    )) === false,
  )
}

function missingPluginReportChecks() {
  console.log('\n== reportMissingBundledPlugins ==')

  const captured = { warn: [], debug: [] }
  const shim = makeNovaShim()
  shim.fs.stat = (p) => (p.includes('prettier-plugin-ejs/index.js') ? null : {})

  global.nova = shim
  const original = { warn: console.warn, info: console.info }
  console.warn = (...args) => captured.warn.push(args.join(' '))
  console.info = (...args) => captured.info.push(args.join(' '))

  for (const file of ['helpers.js', 'format/plugin-registry.js']) {
    delete require.cache[path.join(SRC_DIR, file)]
  }
  const { reportMissingBundledPlugins } = require(
    path.join(SRC_DIR, 'format/plugin-registry.js'),
  )

  reportMissingBundledPlugins(true)
  check(
    'missing entry in bundled mode: warned once',
    captured.warn.length === 1,
    captured.warn,
  )

  reportMissingBundledPlugins(true)
  check('repeated report: deduped', captured.warn.length === 1, captured.warn)

  const restore = () => {
    console.warn = original.warn
    console.info = original.info
  }

  // Native mode: debug level only (debug logging is opt-in in production,
  // so enable it explicitly here)
  global.nova = makeNovaShim({
    configValues: { 'prettier.debug.logging': true },
  })
  global.nova.fs.stat = (p) =>
    p.includes('prettier-plugin-ejs/index.js') ? null : {}
  for (const file of ['helpers.js', 'format/plugin-registry.js']) {
    delete require.cache[path.join(SRC_DIR, file)]
  }
  const debugCaptured = { warn: [], debug: [] }
  const originalDebug = { warn: console.warn, log: console.log }
  console.warn = (...args) => debugCaptured.warn.push(args.join(' '))
  console.log = (...args) => debugCaptured.debug.push(args.join(' '))

  const { reportMissingBundledPlugins: reportNative } = require(
    path.join(SRC_DIR, 'format/plugin-registry.js'),
  )
  reportNative(false)
  check(
    'missing entry in native mode: debug only',
    debugCaptured.warn.length === 0 && debugCaptured.debug.length === 1,
    debugCaptured,
  )

  restore()
  console.log = originalDebug.log
}

function rehydrateErrorChecks() {
  console.log('\n== rehydrateError ==')

  const { rehydrateError } = loadModules(makeNovaShim()).processes

  const full = rehydrateError({
    name: 'TypeError',
    message: 'boom',
    stack: 'TypeError: boom\n    at f',
  })
  check(
    'envelope preserved: name, message, stack',
    full.name === 'TypeError' &&
      full.message === 'boom' &&
      full.stack.includes('boom'),
    full,
  )

  check(
    'missing payload: Unknown error',
    rehydrateError(undefined)?.message === 'Unknown error',
  )

  const bare = rehydrateError({ message: 'only message' })
  check(
    'payload without stack: message only',
    bare.message === 'only message',
    bare,
  )
}

async function applyResultChecks() {
  console.log('\n== applyResult ==')

  const m = loadModules(makeNovaShim())
  const { Formatter } = m
  const fmt = Object.create(Formatter.prototype)

  const replacements = []
  let scrolled = null

  const editor = {
    document: { path: '/d.js', length: 10 },
    selectedRanges: [new Range(2, 8)],
    get selectedRange() {
      return this.selectedRanges[0]
    },
    scrollToPosition: (pos) => {
      scrolled = pos
    },
    edit: async (fn) => {
      fn({
        replace: (range, text) => replacements.push([range, text]),
      })
    },
  }

  // Simple selection: apply + restore cursor + scroll.
  await fmt.applyResult(editor, 'formatted', 5)
  check(
    'simple selection: full-range replace',
    replacements.length === 1 &&
      replacements[0][0].start === 0 &&
      replacements[0][0].end === 10 &&
      replacements[0][1] === 'formatted',
    replacements,
  )

  await applyComplexSelectionChecks(m)
}

async function applyComplexSelectionChecks(m) {
  const { Formatter } = m
  const fmt = Object.create(Formatter.prototype)

  // Multi-cursor: edit still applied, selection left untouched.
  const replacements = []
  const editor = {
    document: { path: '/d.js', length: 10 },
    selectedRanges: [new Range(2, 2), new Range(6, 6)],
    get selectedRange() {
      return this.selectedRanges[0]
    },
    scrollToPosition: () => {},
    edit: async (fn) => {
      fn({ replace: (range, text) => replacements.push([range, text]) })
    },
  }
  await fmt.applyResult(editor, 'formatted', 5)
  check(
    'multi-cursor: edit applied, selection untouched',
    replacements.length === 1 && editor.selectedRanges.length === 2,
    replacements,
  )

  // Anchored (non-caret) selection: same guard.
  const anchored = {
    document: { path: '/d.js', length: 10 },
    selectedRanges: [new Range(2, 8)],
    get selectedRange() {
      return this.selectedRanges[0]
    },
    scrollToPosition: () => {},
    edit: async (fn) => {
      fn({ replace: () => {} })
    },
  }
  await fmt.applyResult(anchored, 'formatted', null)
  check(
    'anchored selection: selection untouched',
    anchored.selectedRanges.length === 1 &&
      anchored.selectedRanges[0].start === 2,
    anchored.selectedRanges,
  )
}

function detectSyntaxChecks() {
  console.log('\n== detectSyntax: general cases ==')

  const m = loadModules(
    makeNovaShim({
      configValues: { 'prettier.syntax.advancedDetection': true },
    }),
  )
  const { detectSyntax } = m.syntax

  const detect = (syntax, uri) => detectSyntax({ syntax, uri })

  check('.astro → astro', detect('astro', '/p/x.astro') === 'astro')
  check('.blade.php → blade', detect('php', '/p/x.blade.php') === 'blade')
  check('.ejs → html+ejs', detect('javascript', '/p/x.ejs') === 'html+ejs')
  check(
    '.liquid → liquid-html',
    detect('liquid', '/p/x.liquid') === 'liquid-html',
  )
  check(
    '.liquid.md → liquid-md',
    detect('liquid', '/p/x.liquid.md') === 'liquid-md',
  )
  check('.toml → toml', detect('toml', '/p/x.toml') === 'toml')
  check('.twig → twig', detect('twig', '/p/x.twig') === 'twig')
  check('.xml → xml', detect('xml', '/p/x.xml') === 'xml')
  check(
    '.properties → java-properties',
    detect('java-properties', '/p/x.properties') === 'java-properties',
  )
  check('.bash → sh', detect('shell', '/p/x.bash') === 'sh')

  // Bare filenames and rc twins
  check(
    'prettier.config.js → javascript',
    detect('javascript', '/p/prettier.config.js') === 'javascript',
  )
  check(
    'rc twin: .prettierrc.yaml → yaml',
    detect('yaml', '/p/.prettierrc.yaml') === 'yaml',
  )
  check('gradlew → sh', detect(null, '/p/gradlew') === 'sh')
  check('hosts → sh', detect(null, '/p/hosts') === 'sh')

  // Dotenv prefixes and .husky hooks
  check('.env.production → sh', detect(null, '/p/.env.production') === 'sh')
  check('.env → sh', detect(null, '/p/.env') === 'sh')
  check('.husky/pre-commit → sh', detect(null, '/p/.husky/pre-commit') === 'sh')

  // SQL aliases normalize to sql
  check('syntax mariadb → sql', detect('mariadb', '/p/x.sql') === 'sql')
  check('syntax shell → sh', detect('shell', '/p/x.sh') === 'sh')

  // Remote scheme parsing still resolves the basename
  check(
    'sftp uri: basename detection',
    detect('shell', 'sftp://host/data/gradlew') === 'sh',
  )

  // Unknown syntax with no extension match: pass-through
  check(
    'unknown syntax: pass-through',
    detect('swift', '/p/x.swift') === 'swift',
  )

  // Advanced detection disabled: trust Nova entirely
  global.nova = makeNovaShim({
    configValues: { 'prettier.syntax.advancedDetection': false },
  })
  for (const file of ['helpers.js', 'format/syntax.js']) {
    delete require.cache[path.join(SRC_DIR, file)]
  }
  const plain = require(path.join(SRC_DIR, 'format/syntax.js')).detectSyntax
  check(
    'advanced detection off: Nova syntax passthrough',
    plain({ syntax: 'shell', uri: '/p/x.bash' }) === 'shell',
  )
}

async function main() {
  composePluginChecks()
  composeOptionChecks()
  prettierErrorChecks()
  prettierErrorNoticeChecks()
  issueMappingChecks()
  await shouldApplyDefaultConfigChecks()
  missingPluginReportChecks()
  rehydrateErrorChecks()
  await applyResultChecks()
  detectSyntaxChecks()

  console.log(
    `\n${failed ? `${failed} check(s) failed` : 'All checks passed.'}`,
  )
  process.exit(failed ? 1 : 0)
}

main()
