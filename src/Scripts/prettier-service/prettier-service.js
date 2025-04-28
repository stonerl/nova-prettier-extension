/**
 * prettier-service.js — Prettier subprocess for format requests
 *
 * @license MIT
 * @author Alexander Weiss, Toni Förster
 * @copyright © 2023 Alexander Weiss, © 2025 Toni Förster
 *
 * Loads Prettier (or prettier-eslint) in a separate Node.js process and handles JSON-RPC requests for formatting and config resolution.
 */

const JsonRpcService = require('./json-rpc.js')

class FormattingService {
  constructor(jsonRpc) {
    this.format = this.format.bind(this)
    this.hasConfig = this.hasConfig.bind(this)

    this.jsonRpc = jsonRpc

    this.jsonRpc.onRequest('format', this.format)
    this.jsonRpc.onRequest('hasConfig', this.hasConfig)
    this.jsonRpc.notify('didStart')
  }

  async format({ original, pathForConfig, ignorePath, options }) {
    throw new Error('Implementation missing')
  }

  async hasConfig({ pathForConfig }) {
    throw new Error('Implementation missing')
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
  }

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
      if (err.message.includes(`Couldn't resolve parser`)) {
        return { missingParser: true }
      }
      throw err
    }
  }

  async hasConfig({ pathForConfig }) {
    const config = await this.prettier.resolveConfig(pathForConfig)
    return config !== null
  }

  async getConfig({ pathForConfig, ignorePath, options }) {
    let info = {}
    if (options.filepath) {
      info = await this.prettier.getFileInfo(options.filepath, {
        ignorePath,
        withNodeModules: false,
      })

      // Don't format if this file is ignored
      if (info.ignored) return { ignored: true }
    }

    let inferredConfig = {}
    // Only resolve external configuration if the flag isn’t set
    if (!options._customConfigFile && !options._ignoreConfigFile) {
      inferredConfig = await this.prettier.resolveConfig(pathForConfig, {
        editorconfig: true,
      })
    }

    const config = { ...options, ...inferredConfig }
    // Prefer prettier's inferred parser over our 'default' based on Nova syntax
    if (info.inferredParser) {
      config.parser = info.inferredParser
    }

    return { ignored: false, config }
  }
}

class PrettierEslintService extends FormattingService {
  static isCorrectModule(module) {
    return typeof module === 'function'
  }

  constructor(jsonRpc, format) {
    super(jsonRpc)

    this.format = format
  }

  async format({ original, pathForConfig, ignorePath, options }) {
    const formatted = this.format({
      text: original,
      fallbackPrettierOptions: options,
    })
    return { formatted }
  }

  async hasConfig({ pathForConfig }) {
    return false
  }
}

const jsonRpcService = new JsonRpcService(process.stdin, process.stdout)
const [, , modulePath] = process.argv

try {
  const module = require(modulePath)
  if (
    modulePath.includes('prettier-eslint') &&
    PrettierEslintService.isCorrectModule(module)
  ) {
    new PrettierEslintService(jsonRpcService, module)
  } else if (PrettierService.isCorrectModule(module)) {
    new PrettierService(jsonRpcService, module)
  } else {
    throw new Error(
      `Module at ${modulePath} does not appear to be prettier or prettier-eslint`,
    )
  }
} catch (err) {
  jsonRpcService.notify('startDidFail', {
    name: err.name,
    message: err.message,
    stack: err.stack,
  })
  process.exit()
}

const shutdown = async () => {
  // if dispose() returns a promise, wait for it (swallow any errors)
  try {
    await jsonRpcService.dispose?.()
  } catch (_) {}

  // ensure stdio pipes don’t keep Node alive
  try {
    process.stdin.destroy()
  } catch (_) {}
  try {
    process.stdout.destroy()
  } catch (_) {}

  // force exit
  process.exit(0)
}

// bind it once for each signal
;['SIGTERM', 'SIGINT'].forEach((signal) => process.once(signal, shutdown))
