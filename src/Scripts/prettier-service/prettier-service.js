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

  async format({ _original, _pathForConfig, _ignorePath, _options }) {
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

  async hasConfig({ _pathForConfig }) {
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
   * >}
   * @throws {never} Formatting errors are caught and returned in `result.error`, so this method never throws
   */
  async format({ original, pathForConfig, ignorePath, options, withCursor }) {
    const { ignored, config } = await this.getConfig({
      pathForConfig,
      ignorePath,
      options,
    })

    if (ignored) return { ignored: true }
    if (!config.parser) return { missingParser: true }

    try {
      // If withCursor flag is true and a cursor offset was provided, use formatWithCursor
      if (withCursor && typeof config.cursorOffset === 'number') {
        // formatWithCursor returns an object with both formatted code and new cursorOffset
        return await this.prettier.formatWithCursor(original, config)
      } else {
        // Otherwise fall back to the regular format method
        return { formatted: await this.prettier.format(original, config) }
      }
    } catch (err) {
      return {
        error: {
          name: err.name,
          message: err.message,
          stack: err.stack,
        },
      }
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
   * @returns {Promise<{ ignored: boolean, config: object }>}
   *   - { ignored: true } if the file is in .prettierignore
   *   - otherwise `{ ignored: false, config }` where `config` is the final Prettier options
   */
  async getConfig({ pathForConfig, ignorePath, options }) {
    let info = {}
    if (options.filepath) {
      if (this._fileInfoCache.has(options.filepath)) {
        info = this._fileInfoCache.get(options.filepath)
      } else {
        info = await this.prettier.getFileInfo(options.filepath, {
          ignorePath,
          withNodeModules: false,
        })
        this._fileInfoCache.set(options.filepath, info)
      }
      if (info.ignored) return { ignored: true }
    }

    let inferredConfig = {}
    if (!options._customConfigFile && !options._ignoreConfigFile) {
      if (this._configCache.has(pathForConfig)) {
        inferredConfig = this._configCache.get(pathForConfig)
      } else {
        inferredConfig = await this.prettier.resolveConfig(pathForConfig, {
          editorconfig: true,
        })
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

    return { ignored: false, config }
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
