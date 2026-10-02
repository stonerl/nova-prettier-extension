/**
 * install-lock.test.js — Unit tests for the cross-process bundled-install
 * lock in install-lock.js
 *
 * @license MIT
 * @author Toni Förster
 * @copyright © 2026 Toni Förster
 *
 * Plain Node script — no test framework. Exits non-zero on failure.
 *
 * Verifies that the lock
 *   • acquires atomically via subprocess mkdir and rejects a second
 *     holder while fresh,
 *   • releases cleanly (rmdir) so a waiter can take over,
 *   • is stealable once stale (holder died, no heartbeat),
 *   • refreshes its staleness window via the touch heartbeat,
 *   • makes waitForBundledInstall return when the lock is released and
 *     keep waiting through a mid-install Prettier appearing on disk,
 *     and bail out at the TTL deadline,
 *   • works with nova.fs.tempdir exposed as the documented string
 *     property (no mkdir -p needed) as well as the function shape, and
 *   • falls back to the extension's global storage when nova.fs has no
 *     usable tempdir at all.
 *
 * The tests simulate two racing extension processes ("windows") by
 * creating two lock instances over the same shared file model. The Nova
 * Process class is stubbed and emulates the coreutils the lock runs
 * (`mkdir`, `touch`, `rmdir`, `rm`) against that model — this is how the
 * entitlement problem is handled: in-process nova.fs writes are blocked
 * in real Nova, so the lock writes go through subprocesses.
 */

const path = require('path')
const fs = require('fs')

const SRC_DIR = fs.realpathSync(
  process.env.INSTALL_LOCK_SRC || path.join(__dirname, '..', 'src', 'Scripts'),
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

/**
 * Nova shim backed by an in-memory file model. The lock's read side
 * (nova.fs.stat) reads this model directly; the write side runs through
 * a stubbed Process class that emulates the coreutils the lock spawns.
 *
 * `withTempdir` toggles nova.fs.tempdir so all exposure shapes can be
 * exercised: `true` = function (defensive), `'property'` = string
 * property (what real Nova exposes, docs list tempdir under
 * Properties), `false` = unavailable (fallback path).
 */
function makeNovaShim({ withTempdir = true } = {}) {
  const files = new Map() // path → { content, mtimeMs }
  const dirs = new Map() // path → mtimeMs

  const TEMPDIR = '/tmp/nova-shared/prettier'
  const GLOBAL_STORAGE = '/tmp/nova-global-storage'
  dirs.set(TEMPDIR, Date.now())

  const now = () => Date.now()

  const shim = {
    tempdirPath: TEMPDIR,
    globalStoragePath: GLOBAL_STORAGE,

    inDevMode: () => false,
    workspace: { path: '/Users/tester/Projects/one' },
    extension: { globalStoragePath: GLOBAL_STORAGE },
    notifications: { post: () => {}, cancel: () => {} },
    config: { get: () => null },
    localize: (key, value) => value ?? key,
    path: {
      join: (...parts) => parts.filter((p) => p != null).join('/'),
      dirname: (p) => p.split('/').slice(0, -1).join('/') || '/',
    },

    fs: {
      tempdir:
        withTempdir === 'property'
          ? TEMPDIR
          : withTempdir
            ? () => TEMPDIR
            : undefined,

      stat(p) {
        if (files.has(p)) {
          return {
            mtime: new Date(files.get(p).mtimeMs),
            isFile: () => true,
            isDirectory: () => false,
            isSymbolicLink: () => false,
          }
        }
        if (dirs.has(p)) {
          return {
            mtime: new Date(dirs.get(p)),
            isFile: () => false,
            isDirectory: () => true,
            isSymbolicLink: () => false,
          }
        }
        return null
      },

      // Only used by the tests to fabricate a Prettier install; the
      // lock itself never writes in-process.
      open(p, mode = 'r') {
        if (mode.includes('x') || mode.includes('w')) {
          if (!files.has(p)) files.set(p, { content: '', mtimeMs: now() })
          const entry = files.get(p)
          return {
            write(value) {
              entry.content = value
              entry.mtimeMs = now()
            },
            close() {},
          }
        }
        const entry = files.get(p)
        if (!entry) throw new Error(`ENOENT: ${p}`)
        return { read: () => entry.content, close() {} }
      },
    },
  }

  shim._agePath = (p, secondsAgo) => {
    if (dirs.has(p)) dirs.set(p, now() - secondsAgo * 1000)
    if (files.has(p)) files.get(p).mtimeMs = now() - secondsAgo * 1000
  }
  shim._pathExists = (p) => files.has(p) || dirs.has(p)

  // Process stub emulating the spawned coreutils against the model.
  const created = []
  class FakeProcess {
    constructor(command, options) {
      this.command = command
      this.options = options
      this._stderrHandlers = []
      this._exitHandlers = []
      created.push(this)
    }

    onStdout() {}

    onStderr(fn) {
      this._stderrHandlers.push(fn)
    }

    onDidExit(fn) {
      this._exitHandlers.push(fn)
    }

    onNotify() {}

    start() {
      // runTool spawns the absolute tool binary with the tool name
      // stripped from args — derive the tool from the command path.
      const tool = this.command.split('/').pop()
      const args = this.options.args
      const target = args[tool === 'rm' ? 1 : 0] // rm starts with '-rf'
      let status = 0

      try {
        if (tool === 'mkdir') {
          const force = args[0] === '-p'
          const p = force ? args[1] : args[0]
          if (force) {
            // Only the parent is force-created; never the lock itself.
            shim.path
              .dirname(p)
              .split('/')
              .filter(Boolean)
              .reduce((acc, part) => {
                const dir = `${acc}/${part}`
                if (!dirs.has(dir)) dirs.set(dir, now())
                return dir
              }, '')
          } else if (dirs.has(p) || files.has(p)) {
            status = 1
            this._stderrHandlers.forEach((fn) => fn(`mkdir: ${p}: File exists`))
          } else {
            dirs.set(p, now())
          }
        } else if (tool === 'touch') {
          const p = args[0]
          if (dirs.has(p)) dirs.set(p, now())
          else if (files.has(p)) files.get(p).mtimeMs = now()
          else files.set(p, { content: '', mtimeMs: now() })
        } else if (tool === 'rmdir') {
          const p = args[0]
          if (dirs.has(p)) dirs.delete(p)
          else status = 1
        } else if (tool === 'rm') {
          const p = args[1]
          dirs.delete(p)
          files.delete(p)
        } else {
          status = 1
        }
      } catch {
        status = 1
      }

      this._exitHandlers.forEach((fn) => fn(status))
    }

    terminate() {}
    kill() {}
  }

  shim._processStub = { FakeProcess, created }

  return shim
}

/**
 * Requires a fresh install-lock.js with the given shim.
 */
function loadInstallLock(novaShim) {
  global.nova = novaShim
  global.Process = novaShim._processStub.FakeProcess

  for (const file of [
    'helpers.js',
    'env/processes.js',
    'notifications.js',
    'env/install-lock.js',
  ]) {
    delete require.cache[path.join(SRC_DIR, file)]
  }
  return require(path.join(SRC_DIR, 'env/install-lock.js'))
}

async function acquisitionAndMutualExclusion() {
  console.log('\n== acquisition and mutual exclusion ==')

  const shim = makeNovaShim()
  const { createInstallLock } = loadInstallLock(shim)

  const windowA = createInstallLock()
  const windowB = createInstallLock()

  check(
    'tempdir is used for the lock directory',
    windowA.path.includes('/tmp/'),
    windowA.path,
  )

  check(
    'acquire succeeds when no lock exists',
    (await windowA.acquire()) === true,
  )

  check(
    'lock tools spawn from absolute system paths',
    shim._processStub.created.length > 0 &&
      shim._processStub.created
        .map((p) => p.command)
        .every((c) => c.startsWith('/bin/') || c === '/usr/bin/touch'),
    shim._processStub.created.map((p) => p.command),
  )

  check('lock is fresh after acquiring', windowA.isHeld() === true)

  check(
    'second window cannot acquire while the lock is fresh',
    (await windowB.acquire()) === false,
  )

  check(
    'lock exists as a directory',
    shim.fs.stat(windowA.path)?.isDirectory() === true,
  )

  await windowA.release()

  check(
    'released lock directory is gone',
    shim._pathExists(windowA.path) === false,
  )

  check('released lock is not held anymore', windowA.isHeld() === false)

  check('waiter can acquire after release', (await windowB.acquire()) === true)
}

async function staleTakeover() {
  console.log('\n== stale takeover ==')

  const shim = makeNovaShim()
  const { createInstallLock } = loadInstallLock(shim)

  const windowA = createInstallLock()
  const windowB = createInstallLock()

  check('window A acquires', (await windowA.acquire()) === true)

  // Simulate window A dying: no heartbeat for 31s (> 30s staleness).
  shim._agePath(windowA.path, 31)

  check(
    'stale lock is no longer held',
    windowA.isHeld() === false && windowB.isHeld() === false,
  )

  check(
    'window B takes over the stale lock',
    (await windowB.acquire()) === true,
  )

  check(
    'stale takeover refreshed the lock (now held)',
    windowB.isHeld() === true,
  )

  // A lock that is 20s old is still inside the staleness window.
  const windowC = createInstallLock()
  await windowC.release()
  check('window C acquires', (await windowC.acquire()) === true)
  shim._agePath(windowC.path, 20)
  check('lock aged 20s is still held (30s window)', windowC.isHeld() === true)
  check(
    'acquire while held-but-fresh is rejected',
    (await windowB.acquire()) === false,
  )
}

async function heartbeatRefreshesStaleness() {
  console.log('\n== heartbeat refreshes staleness ==')

  const shim = makeNovaShim()
  const { createInstallLock } = loadInstallLock(shim)

  const holder = createInstallLock()
  check('holder acquires', (await holder.acquire()) === true)

  shim._agePath(holder.path, 25)
  check('lock aged 25s is still held', holder.isHeld() === true)

  await holder.heartbeat()

  check('heartbeat refreshed the mtime', holder.isHeld() === true)

  const stats = shim.fs.stat(holder.path)
  check(
    'lock age after heartbeat is below 1s',
    Date.now() - stats.mtime.getTime() < 1000,
  )
}

async function waitForBundledInstallExits() {
  console.log('\n== waitForBundledInstall exits ==')

  {
    console.log('-- prettier package.json appears mid-wait --')
    const shim = makeNovaShim()
    const { createInstallLock, waitForBundledInstall } = loadInstallLock(shim)
    const holder = createInstallLock()
    await holder.acquire()

    const prettierPath = '/tmp/nova-shared/never-installed/prettier'
    const pkgPath = `${prettierPath}/package.json`

    // npm writes Prettier's package.json early during an install — its
    // existence must NOT end the wait: the holder still holds the lock,
    // so the tree may be mid-write.
    setTimeout(() => {
      shim.fs.open(pkgPath, 'x').close()
    }, 50)
    // The holder releases later — only then may the waiter return.
    setTimeout(() => {
      holder.release()
    }, 150)

    const start = Date.now()
    await waitForBundledInstall(holder, 5000, 20)
    check(
      'waiter keeps waiting while the lock is held (even with prettier present)',
      shim.fs.stat(pkgPath) !== null &&
        Date.now() - start >= 150 &&
        Date.now() - start < 5000,
    )
  }

  {
    console.log('-- lock released mid-wait --')
    const shim = makeNovaShim()
    const { createInstallLock, waitForBundledInstall } = loadInstallLock(shim)
    const holder = createInstallLock()
    await holder.acquire()

    const prettierPath = '/tmp/nova-shared/never-installed/prettier'
    setTimeout(() => {
      holder.release()
    }, 50)

    const start = Date.now()
    await waitForBundledInstall(holder, 5000, 20)
    check(
      'waiter returns when the lock is released',
      Date.now() - start < 5000 && shim._pathExists(holder.path) === false,
    )
  }

  {
    console.log('-- lock goes stale mid-wait (holder died) --')
    const shim = makeNovaShim()
    const { createInstallLock, waitForBundledInstall } = loadInstallLock(shim)
    const holder = createInstallLock()
    await holder.acquire()

    const prettierPath = '/tmp/nova-shared/never-installed/prettier'
    setTimeout(() => shim._agePath(holder.path, 31), 50)

    const start = Date.now()
    await waitForBundledInstall(holder, 5000, 20)
    check(
      'waiter returns when the holder stops heartbeating',
      Date.now() - start < 5000,
    )
  }

  {
    console.log('-- TTL bail while the lock stays healthy --')
    const shim = makeNovaShim()
    const { createInstallLock, waitForBundledInstall } = loadInstallLock(shim)
    const holder = createInstallLock()
    await holder.acquire()

    // Keep heartbeating so the lock never goes stale.
    const beat = setInterval(() => {
      holder.heartbeat()
    }, 30)

    const start = Date.now()
    await waitForBundledInstall(holder, 150, 20)
    clearInterval(beat)
    check('waiter bails out at the TTL deadline', Date.now() - start >= 150)
  }
}

async function tempdirStringProperty() {
  console.log('\n== nova.fs.tempdir as a string property ==')

  // Real Nova exposes nova.fs.tempdir as a string property (docs list
  // it under Properties, "Added in Nova 10") — the lock must use it
  // without a mkdir -p and without falling back to global storage.
  const shim = makeNovaShim({ withTempdir: 'property' })
  const { createInstallLock } = loadInstallLock(shim)

  const windowA = createInstallLock()
  const windowB = createInstallLock()

  check(
    'property-form tempdir is used for the lock directory',
    windowA.path.startsWith(`${shim.tempdirPath}/`),
    windowA.path,
  )

  check(
    'acquire succeeds without any mkdir -p',
    (await windowA.acquire()) === true &&
      !shim._processStub.created.some(
        (p) => p.command === '/bin/mkdir' && p.options.args[0] === '-p',
      ),
    shim._processStub.created.map((p) => [p.command, p.options.args]),
  )

  check(
    'second window is excluded while fresh',
    (await windowB.acquire()) === false,
  )

  await windowA.release()
}

async function tempdirFallback() {
  console.log('\n== fallback to global storage ==')

  const shim = makeNovaShim({ withTempdir: false })
  const { createInstallLock } = loadInstallLock(shim)

  const windowA = createInstallLock()
  const windowB = createInstallLock()

  check(
    'lock path lives under globalStoragePath',
    windowA.path.startsWith('/tmp/nova-global-storage/'),
    windowA.path,
  )

  check(
    'acquire succeeds (storage dir auto-created)',
    (await windowA.acquire()) === true,
  )

  check(
    'fallback pre-creates only the storage parent via mkdir -p',
    shim._processStub.created
      .filter((p) => p.command === '/bin/mkdir' && p.options.args[0] === '-p')
      .every((p) => p.options.args[1] === shim.globalStoragePath),
    shim._processStub.created.map((p) => [p.command, p.options.args]),
  )

  check(
    'second window is excluded there as well',
    (await windowB.acquire()) === false,
  )
}

async function main() {
  await acquisitionAndMutualExclusion()
  await staleTakeover()
  await heartbeatRefreshesStaleness()
  await waitForBundledInstallExits()
  await tempdirStringProperty()
  await tempdirFallback()

  console.log(
    `\n${failed === 0 ? 'All checks passed.' : `${failed} check(s) failed.`}`,
  )
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
