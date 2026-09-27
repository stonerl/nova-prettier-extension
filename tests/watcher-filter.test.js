/**
 * watcher-filter.test.js — Unit tests for isInsideExtensionBundle in
 * helpers.js, the filter that keeps the extension's own bundled-install
 * writes from triggering service restarts
 *
 * @license MIT
 * @author Toni Förster
 * @copyright © 2026 Toni Förster
 *
 * Plain Node script — no test framework. Exits non-zero on failure.
 *
 * Nova's FileSystemWatcher callbacks report the modified path, but its
 * scoping is looser than documented — events can arrive as absolute
 * paths or workspace-relative paths, even in windows whose workspace
 * doesn't contain the bundle. The helper therefore resolves relative
 * paths against BOTH the workspace and the extension directory and
 * drops an event when either lands inside the bundle.
 */

const path = require('path')
const fs = require('fs')

const SRC_DIR = fs.realpathSync(
  process.env.WATCHER_FILTER_SRC ||
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

const EXTENSION_PATH =
  '/Users/toni/Library/Application Support/Nova/Extensions/stonerl.prettier'
const DEV_BUNDLE_PATH =
  '/Users/toni/Developer/nova-prettier-extension/prettier.novaextension'

function makeNovaShim({ workspacePath, extensionPath = EXTENSION_PATH }) {
  return {
    inDevMode: () => false,
    config: { get: () => null },
    workspace: { path: workspacePath, config: { get: () => null } },
    extension: { path: extensionPath },
    notifications: { post: () => {}, cancel: () => {} },
    path: {
      isAbsolute: (p) => p.startsWith('/'),
      join: (...parts) => parts.filter((p) => p != null).join('/'),
    },
  }
}

function loadHelpers(novaShim) {
  global.nova = novaShim

  for (const file of ['helpers.js', 'notifications.js']) {
    delete require.cache[path.join(SRC_DIR, file)]
  }
  return require(path.join(SRC_DIR, 'helpers.js'))
}

function absolutePaths({ workspacePath = '/Users/toni/Projects/webapp' } = {}) {
  console.log('\n== absolute event paths ==')

  const helpers = loadHelpers(makeNovaShim({ workspacePath }))
  const { isInsideExtensionBundle } = helpers

  check(
    'file inside the bundle (the bundled install writing node_modules)',
    isInsideExtensionBundle(
      `${EXTENSION_PATH}/node_modules/prettier/package.json`,
    ) === true,
  )

  check(
    'the bundle root itself counts as inside',
    isInsideExtensionBundle(EXTENSION_PATH) === true,
  )

  check(
    'a different absolute path outside the bundle is kept',
    isInsideExtensionBundle('/Users/toni/Projects/webapp/package.json') ===
      false,
  )

  check(
    'a sibling directory that only shares a prefix is kept',
    isInsideExtensionBundle(`${EXTENSION_PATH}-sibling/package.json`) === false,
  )

  check(
    'trailing slash on the bundle path still matches contents',
    isInsideExtensionBundle(
      `${EXTENSION_PATH}/node_modules/prettier/doc.js`,
    ) === true,
  )
}

function workspaceRelativePaths({
  workspacePath = '/Users/toni/Projects/webapp',
} = {}) {
  console.log('\n== workspace-relative event paths ==')

  const helpers = loadHelpers(makeNovaShim({ workspacePath }))
  const { isInsideExtensionBundle } = helpers

  check(
    'event in the watched workspace resolves outside the bundle',
    isInsideExtensionBundle('package.json') === false,
  )

  check(
    'event in a workspace subdirectory resolves outside the bundle',
    isInsideExtensionBundle('node_modules/prettier/index.js') === false,
  )
}

function extensionRepoWorkspace() {
  console.log('\n== extension repo as the workspace (self-referential) ==')

  const helpers = loadHelpers(
    makeNovaShim({
      workspacePath: '/Users/toni/Developer/nova-prettier-extension',
      // Nova dev mode loads the extension from the repo, so the bundle
      // lives inside the workspace.
      extensionPath: DEV_BUNDLE_PATH,
    }),
  )
  const { isInsideExtensionBundle } = helpers

  check(
    'workspace-relative event under the bundle is dropped',
    isInsideExtensionBundle(
      'prettier.novaextension/node_modules/prettier/package.json',
    ) === true,
  )

  check(
    'workspace-relative event outside the bundle is kept',
    isInsideExtensionBundle('src/Scripts/main.js') === false,
  )
}

function watcherScopedToExtensionDirectory() {
  console.log(
    '\n== generic relative events are never attributed to the bundle ==',
  )

  const helpers = loadHelpers(
    makeNovaShim({ workspacePath: '/Users/toni/Projects/webapp' }),
  )
  const { isInsideExtensionBundle } = helpers

  check(
    'root package.json event stays a genuine workspace trigger',
    isInsideExtensionBundle('package.json') === false,
  )

  check(
    'node_modules event outside the bundle stays a genuine trigger',
    isInsideExtensionBundle('node_modules/prettier/index.js') === false,
  )
}

function degenerateInputs({
  workspacePath = '/Users/toni/Projects/webapp',
} = {}) {
  console.log('\n== degenerate inputs ==')

  const helpers = loadHelpers(makeNovaShim({ workspacePath }))
  const { isInsideExtensionBundle } = helpers

  check('undefined is not inside', isInsideExtensionBundle(undefined) === false)
  check('null is not inside', isInsideExtensionBundle(null) === false)
  check('empty string is not inside', isInsideExtensionBundle('') === false)

  const trailing = loadHelpers(
    makeNovaShim({
      workspacePath,
      extensionPath: `${EXTENSION_PATH}/`,
    }),
  )
  check(
    'trailing slash on nova.extension.path is tolerated',
    trailing.isInsideExtensionBundle(`${EXTENSION_PATH}/node_modules/x`) ===
      true,
  )
  check(
    'trailing slash still rejects siblings',
    trailing.isInsideExtensionBundle(`${EXTENSION_PATH}-sibling/x`) === false,
  )
}

function noWorkspaceWindow({ workspacePath = null } = {}) {
  console.log('\n== window without a workspace ==')

  const helpers = loadHelpers(makeNovaShim({ workspacePath }))
  const { isInsideExtensionBundle } = helpers

  check(
    'absolute path inside the bundle still matches',
    isInsideExtensionBundle(
      `${EXTENSION_PATH}/node_modules/.package-lock.json`,
    ) === true,
  )

  check(
    'relative event cannot resolve without a workspace — kept',
    isInsideExtensionBundle('package.json') === false,
  )
}

async function main() {
  absolutePaths()
  workspaceRelativePaths()
  extensionRepoWorkspace()
  watcherScopedToExtensionDirectory()
  degenerateInputs()
  noWorkspaceWindow()

  console.log(
    `\n${failed === 0 ? 'All checks passed.' : `${failed} check(s) failed.`}`,
  )
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
