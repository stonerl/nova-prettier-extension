/**
 * prettier-options.js — Prettier⁺ supported config option declarations
 *
 * @license MIT
 * @author Toni Förster
 * @copyright © 2025 Toni Förster
 *
 * Defines which Prettier and plugin options are exposed and configurable in Nova.
 */

module.exports = {
  PRETTIER_OPTIONS: [
    'arrowParens',
    'bracketSameLine',
    'bracketSpacing',
    'embeddedLanguageFormatting',
    'endOfLine',
    'htmlWhitespaceSensitivity',
    'insertPragma',
    'jsxSingleQuote',
    'objectWrap',
    'printWidth',
    'proseWrap',
    'quoteProps',
    'requirePragma',
    'semi',
    'singleAttributePerLine',
    'singleQuote',
    'tabWidth',
    'trailingComma',
    'useTabs',
    'vueIndentScriptAndStyle',
  ],

  PRETTIER_PHP_PLUGIN_OPTIONS: [
    'phpVersion',
    'printWidth',
    'tabWidth',
    'useTabs',
    'singleQuote',
    'trailingCommaPHP',
    'braceStyle',
    'requirePragma',
    'insertPragma',
  ],

  PRETTIER_XML_PLUGIN_OPTIONS: [
    'bracketSameLine',
    'printWidth',
    'singleAttributePerLine',
    'tabWidth',
    'xmlQuoteAttributes',
    'xmlSelfClosingSpace',
    'xmlSortAttributesByKey',
    'xmlWhitespaceSensitivity',
  ],

  PRETTIER_SQL_PLUGIN_SQL_FORMATTER_OPTIONS: [
    'language',
    'keywordCase',
    'dataTypeCase',
    'functionCase',
    'identifierCase',
    'logicalOperatorNewline',
    'expressionWidth',
    'linesBetweenQueries',
    'denseOperators',
    'newlineBeforeSemicolon',
    'params',
    'paramTypes',
  ],

  PRETTIER_SQL_PLUGIN_NODE_SQL_PARSER_OPTIONS: ['database', 'type'],

  PRETTIER_PROPERTIES_PLUGIN_OPTIONS: ['escapeNonLatin1', 'keySeparator'],

  PRETTIER_NGINX_PLUGIN_OPTIONS: [
    'alignDirectives',
    'alignUniversally',
    'wrapParameters',
    'continuationIndent',
  ],
}
