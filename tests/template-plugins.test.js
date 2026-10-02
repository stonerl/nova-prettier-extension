/**
 * template-plugins.test.js — Bundled-mode smoke tests for the template
 * plugins (Nunjucks, Go template, Hugo post, Smarty)
 *
 * @license MIT
 * @author Toni Förster
 * @copyright © 2026 Toni Förster
 *
 * Plain Node script — no test framework. Exits non-zero on failure.
 *
 * Requires `npm run build` and `npm install --omit=dev` inside
 * prettier.novaextension/ (see tests/helpers/json-rpc-client.js).
 *
 * Formats one sample per plugin through the real service and pins the
 * output — these plugins parse template syntax that Prettier's built-in
 * parsers cannot, so a fallback/error-free wrong parse is impossible.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  requireBuiltArtifacts,
  createServiceClient,
} = require('./helpers/json-rpc-client.js')

const EXT_MODULES = path.join(
  __dirname,
  '..',
  'prettier.novaextension',
  'node_modules',
)

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

const CASES = [
  {
    name: 'nunjucks',
    parser: 'nunjucks',
    plugins: [
      path.join(EXT_MODULES, 'prettier-plugin-nunjucks', 'dist', 'plugin.js'),
    ],
    file: 'index.njk',
    original: `{% if x %}\n<p   class="a  b">{{   y  }}</p>\n{% endif %}\n`,
    expected: `{% if x %}\n  <p class="a  b">\n    {{ y }}\n  </p>\n{% endif %}\n`,
  },
  {
    name: 'go-template',
    parser: 'go-template',
    plugins: [
      path.join(
        EXT_MODULES,
        '@htnabe',
        'prettier-plugin-go-template',
        'dist',
        'index.mjs',
      ),
    ],
    file: 'index.gohtml',
    original: `{{ if .Title }}\n<p>{{.}}</p>\n{{ end }}\n`,
    expected: `{{ if .Title }}\n  <p>{{ . }}</p>\n{{ end }}\n`,
  },
  {
    name: 'hugo-post (YAML front matter + shortcodes)',
    parser: 'hugo-post',
    plugins: [
      path.join(
        EXT_MODULES,
        '@htnabe',
        'prettier-plugin-hugo-post',
        'dist',
        'index.mjs',
      ),
    ],
    file: 'post.md',
    original: `---\ntitle: "My Post"\ntags:    [a,   b]\n---\n\n# Hello\n\n{{< note >}}\nText\n{{< /note >}}\n`,
    expected: `---\ntitle: "My Post"\ntags: [a, b]\n---\n\n# Hello\n\n{{< note >}}\nText\n{{< /note >}}\n`,
  },
  {
    name: 'smarty',
    parser: 'smarty',
    plugins: [
      path.join(EXT_MODULES, 'prettier-plugin-smarty', 'src', 'index.js'),
    ],
    file: 'index.tpl',
    original: `<{if $x}>\n<div><{$y}></div>\n<{/if}>\n`,
    expected: `<{if $x}>\n  <div><{$y}></div>\n<{/if}>\n`,
  },
]

async function main() {
  requireBuiltArtifacts()

  // A directory outside the repository so Prettier's config walk-up
  // resolves no config (the repo root has .prettierrc).
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prettier-templates-'))
  const client = createServiceClient({ cwd: tmpDir })

  try {
    await client.waitForStart()

    for (const testCase of CASES) {
      const filepath = path.join(tmpDir, testCase.file)
      const result = await client.requestRaw('format', {
        original: testCase.original,
        pathForConfig: filepath,
        ignorePath: null,
        options: {
          parser: testCase.parser,
          filepath,
          cursorOffset: 0,
          plugins: testCase.plugins,
        },
        withCursor: true,
      })

      check(
        `${testCase.name}: no error payload`,
        result?.error === undefined && result?.formatted !== undefined,
        result,
      )
      check(
        `${testCase.name}: formatted output pinned`,
        result?.formatted === testCase.expected,
        { expected: testCase.expected, actual: result?.formatted },
      )
      check(
        `${testCase.name}: no unresolved/disabled plugins`,
        !result?.unresolvedPlugins?.length && !result?.disabledPlugins?.length,
        {
          unresolved: result?.unresolvedPlugins,
          disabled: result?.disabledPlugins,
        },
      )
    }
  } finally {
    await client.kill()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }

  console.log(
    `\n${failed === 0 ? 'All checks passed.' : `${failed} check(s) failed.`}`,
  )
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
