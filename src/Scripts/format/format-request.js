/**
 * format-request.js — Format request composition for Prettier⁺ for Nova
 *
 * @license MIT
 * @author Toni Förster
 * @copyright © 2026 Toni Förster
 *
 * Composes the plugins and options a format request carries: parser
 * selection, bundled-plugin gating and ordering, plugin-option merging,
 * and the SQL formatter routing between sql-formatter and
 * node-sql-parser.
 */

const { getConfigWithWorkspaceOverride, log } = require('../helpers.js')

const {
  getDefaultConfig,
  getTailwindConfig,
  getSqlFormatterConfig,
  getNodeSqlParserConfig,
} = require('../settings/prettier-config.js')

const { PLUGIN_DESCRIPTORS, isPluginEnabled } = require('./plugin-registry.js')

const {
  getSqlDialectFromUriOrSyntax,
  getSqlParserDialect,
  dialectSupportedBy,
  resolveSqlFormatter,
} = require('./sql.js')

/**
 * Maps a syntax key to the parser name Prettier should use. The service
 * also infers the parser from the file path (which wins); this covers
 * the syntaxes Prettier's inference can't see or gets wrong.
 *
 * @param {string} syntax
 * @returns {string}
 */
function getParserForSyntax(syntax) {
  switch (syntax) {
    case 'javascript':
    case 'jsx':
      return 'babel'
    case 'tsx':
      return 'typescript'
    case 'flow':
      return 'babel-flow'
    case 'java-properties':
      return 'dot-properties'
    case 'liquid-html':
    case 'liquid-md':
      return 'liquid-html-ast'
    case 'html+erb':
    case 'html+ejs':
      return 'html'
    default:
      return syntax
  }
}

/**
 * Resolves the SQL formatter for the document's dialect and assigns the
 * chosen formatter's options onto the request. The SQL formatter
 * setting ('auto', unset, or unknown) routes by dialect: sql-formatter
 * preferred, node-sql-parser fallback.
 *
 * @param {object} opts
 * @param {string} opts.documentUri
 * @param {string|null} opts.documentSyntax
 * @param {object} opts.options – options object to mutate
 * @returns {{ ok: true } | { skip: true, dialect: string } | { mismatch: { dialect: string, selected: string } }}
 */
function resolveSqlOptions({ documentUri, documentSyntax, options }) {
  let sqlFormatter = getConfigWithWorkspaceOverride(
    'prettier.plugins.prettier-plugin-sql.formatter',
  )
  let autoDialect = null

  // Anything not explicitly pinned ('auto', unset, unknown) routes
  // by dialect: sql-formatter preferred, node-sql-parser fallback.
  if (sqlFormatter !== 'sql-formatter' && sqlFormatter !== 'node-sql-parser') {
    autoDialect = getSqlDialectFromUriOrSyntax(documentUri, documentSyntax)
    sqlFormatter = resolveSqlFormatter(autoDialect)

    if (!sqlFormatter) {
      log.info(
        `SQL dialect "${autoDialect}" is not supported by any SQL formatter — formatting skipped`,
      )
      return { skip: true, dialect: autoDialect }
    }

    log.debug(`Auto-detected SQL dialect: ${autoDialect} → ${sqlFormatter}`)
  }

  if (sqlFormatter === 'sql-formatter') {
    const config = { ...getSqlFormatterConfig() }

    if (config.language === 'auto') {
      const dialect =
        autoDialect ?? getSqlDialectFromUriOrSyntax(documentUri, documentSyntax)

      if (!dialectSupportedBy('sql-formatter', dialect)) {
        return { mismatch: { dialect, selected: 'sql-formatter' } }
      }

      config.language = dialect
      log.debug(`Auto-detected SQL dialect: ${dialect}`)
    }

    Object.assign(options, config)
    return { ok: true }
  }

  const config = { ...getNodeSqlParserConfig() }

  if (config.database === 'auto') {
    const dialect = getSqlDialectFromUriOrSyntax(documentUri, documentSyntax)
    config.database = getSqlParserDialect(documentUri, documentSyntax)

    if (config.database === null) {
      return { mismatch: { dialect, selected: 'node-sql-parser' } }
    }

    log.debug(`Using node-sql-parser dialect: ${config.database}`)
  }

  Object.assign(options, config)
  return { ok: true }
}

/**
 * Composes the plugins and options for a format request.
 *
 * @param {object} opts
 * @param {string} opts.syntaxKey
 * @param {TextDocument} opts.document
 * @param {TextEditor} opts.editor
 * @param {string|null} opts.runningPath   – running service's module path
 * @param {string|null} opts.customConfigFile
 * @param {boolean} opts.ignoreConfigFile
 * @param {boolean} opts.applyDefaultConfig
 * @param {boolean} opts.selectionOnly
 * @returns {{ plugins: string[], options: object } | { skip: true, dialect?: string } | { mismatch: { dialect: string, selected: string } }}
 */
function composeFormatRequest({
  syntaxKey,
  document,
  editor,
  runningPath,
  customConfigFile,
  ignoreConfigFile,
  applyDefaultConfig,
  selectionOnly,
}) {
  // Bundled-mode markdown routing: with the Hugo plugin enabled, plain
  // markdown files format through hugo-post (front matter + Hugo
  // shortcodes). The plugin formats the body via the markdown parser,
  // so plain markdown output stays identical.
  if (
    runningPath?.includes(nova.extension.path) &&
    syntaxKey === 'markdown' &&
    !customConfigFile &&
    isPluginEnabled(PLUGIN_DESCRIPTORS['hugo-post'].configKey)
  ) {
    syntaxKey = 'hugo-post'
  }

  // Check if plugins are enabled — Tailwind is driven by both a master
  // flag and a per-syntax flag.
  const tailwindPluginEnabled = isPluginEnabled(
    PLUGIN_DESCRIPTORS.tailwind.configKey,
  )
  const tailwindSyntaxesEnabled = getConfigWithWorkspaceOverride(
    `prettier.plugins.prettier-plugin-tailwind.syntaxes.${syntaxKey}`,
  )

  const plugins = []

  if (runningPath?.includes(nova.extension.path)) {
    const primaryPlugin = PLUGIN_DESCRIPTORS[syntaxKey]

    if (primaryPlugin && isPluginEnabled(primaryPlugin.configKey)) {
      plugins.push(primaryPlugin.pluginPath)
    }

    // For html/html+ejs the EJS plugin must load before tailwind
    // (which must be last). The old ejs+tailwind combo plugin is gone:
    // it crashes on Prettier 3.9's embedded-languages visitor keys and
    // plain ejs + tailwind produces identical output.
    if (syntaxKey === 'html+ejs' || syntaxKey === 'html') {
      if (isPluginEnabled(PLUGIN_DESCRIPTORS.ejs.configKey)) {
        plugins.push(PLUGIN_DESCRIPTORS.ejs.pluginPath)
      }
    }

    // tailwind must be loaded last
    // https://github.com/tailwindlabs/prettier-plugin-tailwindcss#compatibility-with-other-prettier-plugins
    if (tailwindSyntaxesEnabled && tailwindPluginEnabled) {
      plugins.push(PLUGIN_DESCRIPTORS.tailwind.pluginPath)
    }
  }

  const options = {
    parser: getParserForSyntax(syntaxKey),
    ...(plugins.length > 0 ? { plugins } : {}),
    ...(document.path ? { filepath: document.path } : {}),
    // The custom config file is resolved by the service via Prettier's
    // own config resolution — nothing to merge client-side.
    ...(customConfigFile
      ? {}
      : ignoreConfigFile || applyDefaultConfig
        ? getDefaultConfig()
        : {}),
    ...(selectionOnly
      ? {
          rangeStart: editor.selectedRange.start,
          rangeEnd: editor.selectedRange.end,
        }
      : {}),
    // the service reads these to decide how to resolve external config
    _ignoreConfigFile: ignoreConfigFile,
    _customConfigFile: customConfigFile,
  }

  // Plugin options apply only if no config is found or it's ignored.
  if (!customConfigFile && (ignoreConfigFile || applyDefaultConfig)) {
    // Options for the document's syntax — looked up by syntax key
    // regardless of the plugin's enabled flag (previous behavior).
    const optionsConfig = PLUGIN_DESCRIPTORS[syntaxKey]?.optionsConfig
    if (optionsConfig) {
      Object.assign(options, optionsConfig())
    }

    // Tailwind options apply to any supported syntax, not just the
    // syntax the plugin itself parses
    if (tailwindSyntaxesEnabled && tailwindPluginEnabled) {
      Object.assign(options, getTailwindConfig())
    }

    // SQL plugin options depend on the configured formatter
    if (syntaxKey === 'sql') {
      const sqlResult = resolveSqlOptions({
        documentUri: document.uri,
        documentSyntax: document.syntax,
        options,
      })
      if (sqlResult.skip) return sqlResult
      if (sqlResult.mismatch) return sqlResult
    }
  }

  return { plugins, options }
}

module.exports = { composeFormatRequest, getParserForSyntax }
