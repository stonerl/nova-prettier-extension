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

  PRETTIER_ASTRO_PLUGIN_OPTIONS: [
    'astroAllowShorthand',
    'astroSkipFrontmatter',
  ],

  PRETTIER_BLADE_PLUGIN_OPTIONS: [
    'printWidth',
    'tabWidth',
    'singleQuote',
    'wrapAttributes',
    'wrapAttributesMinAttrs',
    'endWithNewLine',
    'sortTailwindcssClasses',
    'tailwindcssConfigPath',
    'sortHtmlAttributes',
    'customHtmlAttributesOrder',
    'noPhpSyntaxCheck',
    'indentInnerHtml',
    'extraLiners',
    'trailingCommaPHP',
    'phpVersion',
    'componentPrefix',
  ],

  PRETTIER_LIQUID_PLUGIN_OPTIONS: [
    'printWidth',
    'tabWidth',
    'useTabs',
    'singleQuote',
    'bracketSameLine',
    'liquidSingleQuote',
    'embeddedSingleQuote',
    'htmlWhitespaceSensitivity',
    'captureWhitespaceSensitivity',
    'singleLineLinkTags',
    'indentSchema',
  ],

  PRETTIER_NGINX_PLUGIN_OPTIONS: [
    'printWidth',
    'tabWidth',
    'useTabs',
    'alignDirectives',
    'alignUniversally',
    'wrapParameters',
    'continuationIndent',
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

  PRETTIER_PROPERTIES_PLUGIN_OPTIONS: ['escapeNonLatin1', 'keySeparator'],

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

  PRETTIER_TAILWIND_PLUGIN_OPTIONS: [
    'tailwindConfig',
    'tailwindStylesheet',
    'tailwindAttributes',
    'tailwindFunctions',
    'tailwindPreserveWhitespace',
    'tailwindPreserveDuplicates',
  ],

  PRETTIER_TOML_PLUGIN_OPTIONS: [
    'alignEntries',
    'alignComments',
    'arrayAutoExpand',
    'arrayAutoCollapse',
    'compactArrays',
    'compactInlineTables',
    'compactEntries',
    'indentTables',
    'indentEntries',
    'reorderKeys',
    'allowedBlankLines',
  ],

  PRETTIER_TWIG_PLUGIN_OPTIONS: [
    'twigSingleQuote',
    'twigAlwaysBreakObjects',
    'twigFollowOfficialCodingStandards',
    'twigOutputEndblockName',
    'twigMultiTags',
    'twigTestExpressions',
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
}
