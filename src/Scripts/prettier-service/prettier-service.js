/**
 * prettier-service.js — Prettier subprocess for format requests
 *
 * @license MIT
 * @author Alexander Weiss, Toni Förster
 * @copyright © 2023 Alexander Weiss, © 2025 Toni Förster
 *
 * Loads Prettier in a separate Node.js process and handles JSON-RPC requests
 * for formatting and config resolution.
 */

const path = require('path')
const fs = require('fs')
const url = require('url')

const JsonRpcService = require('./json-rpc.js')

class FormattingService {
  constructor(jsonRpc) {
    this.format = this.format.bind(this)
    this.hasConfig = this.hasConfig.bind(this)

    this.jsonRpc = jsonRpc

    this.jsonRpc.onRequest('format', this.format)
    this.jsonRpc.onRequest('hasConfig', this.hasConfig)
  }

  /**
   * Abstract method. Must be implemented by subclass.
   * @param {object} params
   * @param {string} params.original
   * @param {string} params.pathForConfig
   * @param {string|null} params.ignorePath
   * @param {object} params.options
   * @throws {Error} Always throws unless overridden
   */

  async format() {
    throw new Error(
      'FormattingService.format() must be implemented by subclass',
    )
  }

  /**
   * Abstract method. Must be implemented by subclass.
   * @param {object} params
   * @param {string} params.pathForConfig
   * @throws {Error} Always throws unless overridden
   */

  async hasConfig() {
    throw new Error(
      'FormattingService.hasConfig() must be implemented by subclass',
    )
  }
}

class PrettierService extends FormattingService {
  static isCorrectModule(module) {
    return (
      typeof module.format === 'function' &&
      typeof module.getFileInfo === 'function' &&
      typeof module.resolveConfig === 'function'
    )
  }

  constructor(jsonRpc, prettier) {
    super(jsonRpc)
    this.prettier = prettier
    this._configCache = new Map()
    this._fileInfoCache = new Map()
    this._pluginResolutionCache = new Map()
  }

  /**
   * Format the provided source using Prettier.
   *
   * @param {Object} params
   * @param {string} params.original       – The original source text to format
   * @param {string} params.pathForConfig  – Path to use when resolving .prettierrc or similar
   * @param {string|null} params.ignorePath – Path to a `.prettierignore` file (or null)
   * @param {object} params.options        – User-specified Prettier options
   * @param {boolean} [params.withCursor]  – If true, returns `{ formatted, cursorOffset }`
   * @returns {Promise<
   *   { formatted: string } |
   *   { cursorOffset: number, formatted: string } |
   *   { ignored: true } |
   *   { missingParser: true } |
   *   { error: { name: string, message: string, stack: string } }
   * >} – plus, when the user's config declares plugins:
   *   `{ loadedPlugins: string[], unresolvedPlugins?: string[], disabledPlugins?: string[] }`
   *   and, when the client's custom config file failed to load:
   *   `configError: { path: string, message: string }`
   * @throws {never} Formatting errors are caught and returned in `result.error`, so this method never throws
   */
  async format({ original, pathForConfig, ignorePath, options, withCursor }) {
    let ignored, config, pluginReport, configError
    try {
      ;({ ignored, config, pluginReport, configError } = await this.getConfig({
        pathForConfig,
        ignorePath,
        options,
      }))
    } catch (err) {
      // Config resolution (getFileInfo / resolveConfig) runs outside the
      // format try/catch below — structure its failures the same way so
      // the client logs a real error instead of an opaque IPC rejection.
      return this._errorResult(err)
    }

    if (ignored) return { ignored: true }
    if (!config.parser) return { missingParser: true }

    const runFormat = (cfg, useCursor) => {
      // If withCursor flag is true and a cursor offset was provided, use formatWithCursor
      if (useCursor && typeof cfg.cursorOffset === 'number') {
        // formatWithCursor returns an object with both formatted code and new cursorOffset
        return this.prettier.formatWithCursor(original, cfg)
      }
      return this.prettier
        .format(original, cfg)
        .then((formatted) => ({ formatted }))
    }

    // Plugins resolved from the project (not bundled with the extension).
    // Load-time failures are already filtered out during config resolution
    // (see getConfig → _preloadExternalPlugins). If any remaining plugin
    // fails while formatting — usually a runtime incompatibility with the
    // bundled Prettier — retry once without them and report which plugins
    // were disabled.
    const externalEntries = pluginReport?.externalEntries ?? []

    try {
      const result = await runFormat(config, withCursor)
      return this._withPluginReport(result, pluginReport, [], configError)
    } catch (err) {
      let lastError = err

      // A crash while mapping the cursor (some plugins' locStart/locEnd
      // are not cursor-safe) must not lose the whole format: retry once
      // without cursor tracking. The client already falls back to the
      // editor position when no cursor offset comes back.
      if (withCursor && typeof config.cursorOffset === 'number') {
        try {
          const result = await runFormat(config, false)
          return this._withPluginReport(result, pluginReport, [], configError)
        } catch (retryErr) {
          lastError = retryErr
        }
      }

      if (externalEntries.length === 0) return this._errorResult(lastError)

      // Identify the failing plugin by dropping one candidate at a time
      // (bounded), then fall back to disabling all remaining externals.
      // All recovery attempts run without cursor tracking — the cursor
      // crash path above was already tried, and cursorless results keep
      // the diagnosis clean.
      const MAX_CULPRIT_ATTEMPTS = 3
      const cleared = []

      for (
        let i = 0;
        i < externalEntries.length && i < MAX_CULPRIT_ATTEMPTS;
        i++
      ) {
        const candidate = externalEntries[i]
        const dropped = [...cleared, candidate]
        try {
          const configWithoutCandidate = {
            ...config,
            plugins: (config.plugins ?? []).filter(
              (entry) => !dropped.includes(entry),
            ),
          }
          const result = await runFormat(configWithoutCandidate, false)
          return this._withPluginReport(
            result,
            pluginReport,
            [
              pluginReport.externalNames[
                pluginReport.externalEntries.indexOf(candidate)
              ],
            ],
            configError,
          )
        } catch {
          // the candidate wasn't (the only) culprit — keep it dropped and
          // move on to the next one
          cleared.push(candidate)
        }
      }

      // Culprit not isolated (or more than MAX_CULPRIT_ATTEMPTS externals):
      // disable all remaining externals and try once more.
      try {
        const configWithoutExternals = {
          ...config,
          plugins: (config.plugins ?? []).filter(
            (entry) => !cleared.includes(entry),
          ),
        }
        const result = await runFormat(configWithoutExternals, false)
        const names = cleared.map(
          (entry) =>
            pluginReport.externalNames[
              pluginReport.externalEntries.indexOf(entry)
            ],
        )
        return this._withPluginReport(result, pluginReport, names, configError)
      } catch (retryErr) {
        return this._errorResult(retryErr)
      }
    }
  }

  /**
   * Attach the config-plugin classification and any custom-config load
   * error to a format result, keeping the payload lean: only non-empty
   * lists are sent.
   *
   * @param {object} result
   * @param {object|null} pluginReport – from getConfig
   * @param {string[]} [extraDisabled] – names disabled additionally (e.g. by
   *                                     the format-time retry)
   * @param {object|null} [configError] – custom config load failure
   *                                      ({ path, message }) from getConfig
   * @returns {object}
   */
  _withPluginReport(result, pluginReport, extraDisabled = [], configError) {
    if (!pluginReport && !configError) return result
    if (!pluginReport) return { ...result, configError }
    const disabled = [...pluginReport.disabledNames, ...extraDisabled]
    return {
      ...result,
      ...(pluginReport.externalNames.length > 0
        ? { loadedPlugins: pluginReport.externalNames }
        : {}),
      ...(pluginReport.unresolved.length > 0
        ? { unresolvedPlugins: pluginReport.unresolved }
        : {}),
      ...(disabled.length > 0 ? { disabledPlugins: disabled } : {}),
      ...(pluginReport.configFile
        ? { configFile: pluginReport.configFile }
        : {}),
    }
  }

  /**
   * Shape a thrown value into the structured error result the client
   * expects, filling in fallbacks for non-Error rejections.
   *
   * @param {unknown} err
   * @returns {{ error: { name: string, message: string, stack?: string } }}
   */
  _errorResult(err) {
    return {
      error: {
        name: err?.name ?? 'ServiceError',
        message: err?.message ?? String(err),
        ...(err?.stack ? { stack: err.stack } : {}),
      },
    }
  }

  /**
   * Check whether Prettier would find a configuration file at the given path.
   *
   * @param {Object} params
   * @param {string} params.pathForConfig – Path to check for a Prettier config
   * @returns {Promise<boolean>}          – True if a config was found, else false
   */
  async hasConfig({ pathForConfig }) {
    const config = await this.prettier.resolveConfig(pathForConfig)
    return config !== null
  }

  /**
   * Internal helper: resolve and merge Prettier options, honoring ignores and caching.
   *
   * @param {Object} params
   * @param {string}      params.pathForConfig  – Base path for locating config
   * @param {string|null} params.ignorePath     – Path to ignore-file (or null)
   * @param {object}      params.options        – Raw options from the RPC payload
   * @returns {Promise<{ ignored: boolean, config: object, pluginReport?: object, configError?: object }>}
   *   - { ignored: true } if the file is in .prettierignore
   *   - otherwise `{ ignored: false, config }` where `config` is the final Prettier options
   *   - `pluginReport` (only when the client injected bundled plugins and the
   *     config declares plugins): classification of the declared plugins —
   *   `{ plugins, externalEntries, externalNames, unresolved }`
   *   - `configError` (only when the client's explicit custom config file
   *     failed to load): `{ path, message }` — formatting continues with
   *     the remaining options
   */
  async getConfig({ pathForConfig, ignorePath, options }) {
    let info = {}
    if (options.filepath) {
      // Cache key includes every input that can change the result, so a
      // normal lookup (ignorePath set) can never poison a forced one
      // (ignorePath null) and vice versa. (withNodeModules is always
      // false here and thus not part of the key.)
      const cacheKey = `${options.filepath}\u0000${ignorePath ?? ''}`
      if (this._fileInfoCache.has(cacheKey)) {
        info = this._fileInfoCache.get(cacheKey)
      } else {
        info = await this.prettier.getFileInfo(options.filepath, {
          ignorePath,
          withNodeModules: false,
          // The client always sends an explicit parser; passing it through
          // skips Prettier's expensive inference path (resolveConfig +
          // plugin loading), making uncached lookups near-free.
          ...(options.parser ? { parser: options.parser } : {}),
        })
        this._fileInfoCache.set(cacheKey, info)
      }
      if (info.ignored) return { ignored: true }
    }

    let inferredConfig = {}
    let configError
    if (options._customConfigFile) {
      // The client points at an explicit config file. Prettier's own
      // resolution loads it (JSON, YAML, TOML, JS…), replacing the old
      // client-side JSON.parse, which silently dropped every other format.
      try {
        inferredConfig =
          (await this.prettier.resolveConfig(pathForConfig, {
            config: options._customConfigFile,
            editorconfig: true,
          })) ?? {}
      } catch (err) {
        // Surface the failure to the client (which shows a notification);
        // formatting continues with the remaining options.
        configError = {
          path: options._customConfigFile,
          message: err?.message ?? String(err),
        }
      }
    } else if (!options._ignoreConfigFile) {
      if (this._configCache.has(pathForConfig)) {
        inferredConfig = this._configCache.get(pathForConfig)
      } else {
        // resolveConfig returns null when no config file (and, with
        // editorconfig enabled, no .editorconfig) exists anywhere above
        // the file — normalize before caching so downstream shape
        // assumptions hold.
        inferredConfig =
          (await this.prettier.resolveConfig(pathForConfig, {
            editorconfig: true,
          })) ?? {}
        this._configCache.set(pathForConfig, inferredConfig)
      }
    }

    // inferredConfig comes first, user options override
    const config = { ...inferredConfig, ...options }

    // [optional] cleanup internal flags so Prettier doesn’t see them
    delete config._customConfigFile
    delete config._ignoreConfigFile

    if (info.inferredParser) {
      config.parser = info.inferredParser
    }

    // Merge config-declared plugins with the bundled set injected by the
    // client. Runs in every module resolution mode:
    // - bundled mode (options.plugins non-empty): declared plugins are
    //   merged with the bundled set — bundled wins, externals are resolved
    //   from the project, load failures are isolated, runtime failures get
    //   a retry without them.
    // - explicit-path / project Prettier: nothing is injected, so this is
    //   a best-effort upgrade only — resolvable plugins are replaced with
    //   absolute paths (document-dir anchored, so monorepo subpackages
    //   work), everything else passes through untouched and keeps Prettier's
    //   native CLI error behavior.
    let pluginReport
    if (
      Array.isArray(inferredConfig.plugins) &&
      inferredConfig.plugins.length > 0
    ) {
      pluginReport = this._mergeConfigPlugins({
        inferredPlugins: inferredConfig.plugins,
        bundledPaths: options.plugins ?? [],
        baseDir: path.dirname(pathForConfig),
      })

      if (pluginReport.plugins.length > 0) {
        config.plugins = pluginReport.plugins
      }

      // Tell the client which config file declared the (unresolvable)
      // plugins so its notice can point users at the right file.
      if (pluginReport.unresolved.length > 0) {
        try {
          pluginReport.configFile =
            await this.prettier.resolveConfigFile(pathForConfig)
        } catch {
          // No resolvable config file — the notice simply omits the hint.
        }
      }

      // Load each external plugin up front so one that fails to load
      // (syntax error, missing dependency, ESM incompatibility…) is
      // disabled alone instead of taking down the whole format request.
      // Bundled mode only — externalEntries stays empty in native modes.
      if (pluginReport.externalEntries.length > 0) {
        await this._preloadExternalPlugins(pluginReport)
      }
    }

    return { ignored: false, config, pluginReport, configError }
  }

  /**
   * Merge the plugins declared in the user's Prettier config with the
   * bundled plugin paths injected by the extension client.
   *
   * Each declared entry (a string specifier, or a `[specifier, options]`
   * tuple) is classified:
   * - bundled package → dropped; the bundled equivalent is already in the
   *   injected list (the bundled version wins)
   * - `file:` URL or absolute path → passed through untouched
   * - package name / subpath → resolved to an absolute path, anchored at
   *   the formatted file's directory (Node's resolution walks up
   *   node_modules chains, so monorepo subpackages and pnpm layouts work)
   * - unresolvable → in bundled mode reported back to the client, which
   *   shows a notice; in native mode passed through so Prettier's own
   *   resolution (and its native error behavior) still applies
   *
   * Load-failure isolation and the runtime retry only apply in bundled
   * mode — native modes keep CLI parity: `externalEntries` stays empty,
   * so `_preloadExternalPlugins` and the format-time retry never engage.
   *
   * prettier-plugin-tailwindcss is always moved to the end of the merged
   * list — it must be loaded last.
   *
   * @param {Array}  inferredPlugins – `plugins` array from the resolved config
   * @param {string[]} bundledPaths  – absolute plugin paths injected by the
   *                                   client (empty in native modes)
   * @param {string} baseDir         – directory of the formatted file
   * @returns {{ plugins: Array, externalEntries: Array, externalNames: string[], unresolved: string[], disabledNames: string[] }}
   */
  _mergeConfigPlugins({ inferredPlugins, bundledPaths, baseDir }) {
    const bundledMode = bundledPaths.length > 0
    const isBundled = (specifier) =>
      bundledMode &&
      typeof specifier === 'string' &&
      bundledPaths.some((bundledPath) => bundledPath.includes(specifier))

    // The merged list starts with the bundled paths the client injected —
    // they remain active even when external plugins are added alongside
    // them. Declared entries that match a bundled plugin are skipped (the
    // bundled version already covers them); everything else is appended.
    const merged = [...bundledPaths]
    const externalEntries = []
    const externalNames = []
    const unresolved = []

    for (const declared of inferredPlugins) {
      const isTuple = Array.isArray(declared)
      const specifier = isTuple ? declared[0] : declared

      if (isBundled(specifier)) continue

      // Non-string entries (plugin objects) and file: URLs load as-is;
      // Prettier imports URLs directly.
      if (
        typeof specifier !== 'string' ||
        specifier.startsWith('file:') ||
        path.isAbsolute(specifier)
      ) {
        merged.push(declared)
        continue
      }

      const resolvedPath = this._resolvePluginSpecifier(specifier, baseDir)
      if (resolvedPath) {
        const entry = isTuple ? [resolvedPath, declared[1]] : resolvedPath
        merged.push(entry)

        // In native modes only report the upgrade — no isolation, no retry.
        if (!bundledMode) {
          externalNames.push(specifier)
          continue
        }

        externalEntries.push(entry)
        externalNames.push(specifier)
      } else if (bundledMode) {
        unresolved.push(specifier)
      } else {
        // Native mode: pass the declaration through untouched — Prettier
        // may still resolve it (e.g. via cwd) and errors stay native.
        merged.push(declared)
      }
    }

    // prettier-plugin-tailwindcss must be loaded last.
    // See: https://github.com/tailwindlabs/prettier-plugin-tailwindcss#compatibility-with-other-prettier-plugins
    const isTailwind = (entry) => {
      const specifier = Array.isArray(entry) ? entry[0] : entry
      return (
        typeof specifier === 'string' &&
        specifier.includes('prettier-plugin-tailwindcss')
      )
    }

    return {
      plugins: [
        ...merged.filter((entry) => !isTailwind(entry)),
        ...merged.filter((entry) => isTailwind(entry)),
      ],
      externalEntries,
      externalNames,
      unresolved,
      disabledNames: [],
    }
  }

  /**
   * Import each external plugin so a load-time failure (syntax error,
   * missing dependency, ESM incompatibility…) disables that plugin alone
   * before any format request runs. Prettier loads plugins with `import()`
   * too, so this mirrors exactly what formatting would do — and Node's
   * module cache means each plugin is evaluated only once.
   *
   * @param {object} pluginReport – mutated in place
   */
  async _preloadExternalPlugins(pluginReport) {
    const { plugins, externalEntries, externalNames, disabledNames } =
      pluginReport

    for (let i = externalEntries.length - 1; i >= 0; i--) {
      const entry = externalEntries[i]
      const pluginPath = Array.isArray(entry) ? entry[0] : entry

      try {
        await import(url.pathToFileURL(pluginPath).href)
      } catch {
        plugins.splice(plugins.indexOf(entry), 1)
        externalEntries.splice(i, 1)
        disabledNames.push(externalNames[i])
        externalNames.splice(i, 1)
      }
    }
  }

  /**
   * Resolve a config-declared plugin specifier to an absolute path,
   * anchored at the formatted file's directory. Results are cached —
   * the service restarts on package.json / config file changes, which
   * clears the cache whenever a re-resolution could yield a new result.
   *
   * @param {string} specifier – package name, subpath, or relative path
   * @param {string} baseDir   – directory of the formatted file
   * @returns {string|null}    – absolute entry path, or null if unresolvable
   */
  _resolvePluginSpecifier(specifier, baseDir) {
    const cacheKey = `${specifier}\u0000${baseDir}`
    if (this._pluginResolutionCache.has(cacheKey)) {
      return this._pluginResolutionCache.get(cacheKey)
    }

    let resolvedPath = null
    try {
      resolvedPath = require.resolve(specifier, {
        paths: [baseDir, process.cwd()],
      })
    } catch {
      // require.resolve fails for ESM-only packages
      // (ERR_PACKAGE_PATH_NOT_EXPORTED) — fall back to reading their
      // package.json manually.
      resolvedPath = this._resolvePluginFromNodeModules(specifier, baseDir)
    }

    this._pluginResolutionCache.set(cacheKey, resolvedPath)
    return resolvedPath
  }

  /**
   * Fallback for packages without a CJS entry point: walk up from
   * `baseDir` looking for `node_modules/<package>`, then pick the entry
   * file from its package.json. Prettier imports the returned path, so
   * ESM entries (.mjs, exports.import) work.
   *
   * @param {string} specifier – package name, possibly with a subpath
   * @param {string} baseDir   – directory to start the walk-up from
   * @returns {string|null}
   */
  _resolvePluginFromNodeModules(specifier, baseDir) {
    const segments = specifier.split('/')
    const [packageName, rest] = specifier.startsWith('@')
      ? [segments.slice(0, 2).join('/'), segments.slice(2)]
      : [segments[0], segments.slice(1)]

    let dir = baseDir
    while (true) {
      const packageDir = path.join(dir, 'node_modules', packageName)
      const packageJsonPath = path.join(packageDir, 'package.json')

      if (fs.existsSync(packageJsonPath)) {
        try {
          const packageJson = JSON.parse(
            fs.readFileSync(packageJsonPath, 'utf8'),
          )

          if (rest.length > 0) {
            const candidate = path.join(packageDir, ...rest)
            if (fs.existsSync(candidate)) return candidate
          } else {
            const entry = this._pickPackageEntry(packageJson)
            if (entry) return path.join(packageDir, entry)
          }
        } catch {
          // malformed package.json — keep walking
        }
      }

      const parent = path.dirname(dir)
      if (parent === dir) return null
      dir = parent
    }
  }

  /**
   * Pick an entry file from a package.json: exports "." (import >
   * default > require) first, then main, then index.js.
   *
   * @param {object} packageJson
   * @returns {string|null} – entry path relative to the package directory
   */
  _pickPackageEntry(packageJson) {
    const rootExport = packageJson.exports?.['.']
    const candidates = []

    if (typeof rootExport === 'string') {
      candidates.push(rootExport)
    } else if (rootExport && typeof rootExport === 'object') {
      candidates.push(rootExport.import, rootExport.default, rootExport.require)
    }
    candidates.push(packageJson.main, 'index.js')

    const entry = candidates.find((candidate) => typeof candidate === 'string')
    return entry ? entry.replace(/^\.\//, '') : null
  }
}

let jsonRpcService
;(async () => {
  // 1) instantiate and register handlers
  jsonRpcService = new JsonRpcService(process.stdin, process.stdout)
  const [, , modulePath] = process.argv

  process.on('uncaughtException', async (err) => {
    await jsonRpcService.notify('didCrash', {
      name: err.name,
      message: err.message,
      stack: err.stack,
    })
    process.exit(1)
  })
  process.on('unhandledRejection', async (reason) => {
    await jsonRpcService.notify('didCrash', {
      name: reason?.name || 'UnhandledRejection',
      message: reason?.message || String(reason),
      stack: reason?.stack,
    })
    process.exit(1)
  })

  try {
    const module = require(modulePath)
    if (PrettierService.isCorrectModule(module)) {
      new PrettierService(jsonRpcService, module)
    } else {
      throw new Error(
        `Module at ${modulePath} does not appear to be a valid Prettier module`,
      )
    }

    // 2) await the startup notification so we know it went out
    await jsonRpcService.notify('didStart')
  } catch (err) {
    // if we failed during bootstrap, notify and exit
    if (jsonRpcService) {
      await jsonRpcService.notify('startDidFail', {
        name: err.name,
        message: err.message,
        stack: err.stack,
      })
    }
    process.exit(1)
  }

  // 3) graceful shutdown
  process.once('SIGTERM', async () => {
    try {
      await jsonRpcService.dispose()
      process.stdin.destroy()
      process.stdout.destroy()
    } catch {
      /* swallow */
    }
    process.exit(0)
  })
})()
