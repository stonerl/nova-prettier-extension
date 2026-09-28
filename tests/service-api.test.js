/**
 * service-api.test.js — Unit tests for the Prettier service's
 * prettier-API usage contract (getFileInfo options in particular)
 *
 * @license MIT
 * @author Toni Förster
 * @copyright © 2026 Toni Förster
 *
 * Plain Node script — no test framework. Exits non-zero on failure.
 *
 * Locks the documented getFileInfo contract against regressions:
 *   • the call passes exactly `{ ignorePath, withNodeModules: false,
 *     resolveConfig: false }` — resolveConfig:false skips Prettier's
 *     internal config walk-up (we resolve config separately), and the
 *     dead `parser` passthrough (not a supported FileInfoOption in the
 *     bundled Prettier — verified against index.d.ts) must stay gone,
 *   • an ignored verdict short-circuits without calling format,
 *   • the inferred parser from getFileInfo overrides the client's
 *     parser, and user options override the inferred config.
 *
 * Instantiates PrettierService with a recording stub prettier — no
 * subprocess, no real Prettier.
 */

const path = require('path')
const fs = require('fs')

const SRC_DIR = fs.realpathSync(
  process.env.SERVICE_API_SRC ||
    path.join(__dirname, '..', 'src', 'Scripts', 'prettier-service'),
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

function loadService() {
  delete require.cache[path.join(SRC_DIR, 'prettier-service.js')]
  delete require.cache[path.join(SRC_DIR, 'json-rpc.js')]
  return require(path.join(SRC_DIR, 'prettier-service.js'))
}

function makeService(prettierStub) {
  const { PrettierService } = loadService()
  const jsonRpcStub = {
    onRequest() {
      return { dispose() {} }
    },
  }
  return new PrettierService(jsonRpcStub, prettierStub)
}

function getFileInfoContract() {
  console.log('\n== getFileInfo options contract ==')

  const calls = []
  const service = makeService({
    format: async () => ({ formatted: 'x\n' }),
    getFileInfo: async (file, options) => {
      calls.push({ file, options })
      return { ignored: false, inferredParser: null }
    },
    resolveConfig: async () => null,
  })

  return service
    .getConfig({
      pathForConfig: '/project/file.js',
      ignorePath: '/project/.prettierignore',
      options: {
        filepath: '/project/file.js',
        parser: 'babel',
        semi: false,
      },
    })
    .then(() => {
      check('getFileInfo called once', calls.length === 1, calls.length)

      const { options } = calls[0]
      const expected = {
        ignorePath: '/project/.prettierignore',
        withNodeModules: false,
        resolveConfig: false,
      }

      check(
        'exactly the documented ignore-only options are passed',
        JSON.stringify(options) === JSON.stringify(expected),
        options,
      )
      check(
        'no dead parser passthrough (not a supported FileInfoOption)',
        !('parser' in options),
        options,
      )
      check(
        'resolveConfig:false present (skips the internal config walk-up)',
        options.resolveConfig === false,
        options,
      )
    })
}

async function ignoredShortCircuitsFormat() {
  console.log('\n== ignored verdict short-circuits ==')

  let formatCalled = 0
  const service = makeService({
    format: async () => {
      formatCalled++
      return { formatted: 'x\n' }
    },
    getFileInfo: async () => ({ ignored: true, inferredParser: null }),
    resolveConfig: async () => null,
  })

  const result = await service.format({
    original: 'x',
    pathForConfig: '/project/file.js',
    ignorePath: '/project/.prettierignore',
    options: { filepath: '/project/file.js', parser: 'babel' },
  })

  check('format reports ignored', result.ignored === true, result)
  check('prettier.format never ran', formatCalled === 0, formatCalled)
}

async function inferredParserAndOptionPrecedence() {
  console.log('\n== inferred parser + option precedence ==')

  const formatCalls = []
  const service = makeService({
    format: async (source, options) => {
      formatCalls.push(options)
      return { formatted: 'x\n' }
    },
    getFileInfo: async () => ({
      ignored: false,
      inferredParser: 'typescript',
    }),
    resolveConfig: async () => ({ semi: true, printWidth: 80 }),
  })

  await service.format({
    original: 'x',
    pathForConfig: '/project/file.ts',
    ignorePath: null,
    options: { filepath: '/project/file.ts', parser: 'babel', semi: false },
  })

  const finalOptions = formatCalls[0] ?? {}

  check(
    'inferredParser from getFileInfo overrides the client parser',
    finalOptions.parser === 'typescript',
    finalOptions,
  )

  check(
    'user options override the inferred config',
    finalOptions.semi === false && finalOptions.printWidth === 80,
    finalOptions,
  )

  check(
    'internal flags are stripped before the prettier call',
    !('_ignoreConfigFile' in finalOptions) &&
      !('_customConfigFile' in finalOptions),
    finalOptions,
  )
}

async function main() {
  await getFileInfoContract()
  await ignoredShortCircuitsFormat()
  await inferredParserAndOptionPrecedence()

  console.log(
    `\n${failed === 0 ? 'All checks passed.' : `${failed} check(s) failed.`}`,
  )
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
