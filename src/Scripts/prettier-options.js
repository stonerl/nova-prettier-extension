// prettier-options.js
module.exports = {
  PRETTIER_OPTIONS: [
    'arrowParens',
    'bracketSameLine',
    'bracketSpacing',
    'embeddedLanguageFormatting',
    'endOfLine',
    'htmlWhitespaceSensitivity',
    'insertPragma',
    'jsxBracketSameLine',
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

  PRETTIER_PHP_PLUGIN_OPTIONS: ['phpVersion', 'trailingCommaPHP', 'braceStyle'],

  PRETTIER_XML_PLUGIN_OPTIONS: [
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
