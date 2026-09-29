/**
 * workspace-choices.js — Generated from src/unifiedConfig.json by scripts/generate-workspace-choices.js
 *
 * @license MIT
 * @author Toni Förster
 * @copyright © 2026 Toni Förster
 *
 * Own choices for each workspace enum setting whose first choice is the
 * null-valued "Global Setting" fallback. Do not edit by hand.
 */

/** @type {Record<string, Array<[string|boolean, string]>>} */
const WORKSPACE_CHOICES = {
  'prettier.module.preferBundled': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.config.ignore': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.syntax.advancedDetection': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.debug.logging': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.default-config.useTabs': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.default-config.semi': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.default-config.singleQuote': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.default-config.quoteProps': [
    ['as-needed', 'as-needed'],
    ['consistent', 'consistent'],
    ['preserve', 'preserve'],
  ],
  'prettier.default-config.jsxSingleQuote': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.default-config.trailingComma': [
    ['all', 'all'],
    ['es5', 'es5'],
    ['none', 'none'],
  ],
  'prettier.default-config.bracketSpacing': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.default-config.objectWrap': [
    ['preserve', 'preserve'],
    ['collapse', 'collapse'],
  ],
  'prettier.default-config.bracketSameLine': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.default-config.arrowParens': [
    ['always', 'always'],
    ['avoid', 'avoid'],
  ],
  'prettier.default-config.requirePragma': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.default-config.insertPragma': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.default-config.checkIgnorePragma': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.default-config.proseWrap': [
    ['always', 'always'],
    ['never', 'never'],
    ['preserve', 'preserve'],
  ],
  'prettier.default-config.htmlWhitespaceSensitivity': [
    ['css', 'css'],
    ['strict', 'strict'],
    ['ignore', 'ignore'],
  ],
  'prettier.default-config.vueIndentScriptAndStyle': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.default-config.endOfLine': [
    ['lf', 'lf'],
    ['crlf', 'crlf'],
    ['cr', 'cr'],
    ['auto', 'auto'],
  ],
  'prettier.default-config.embeddedLanguageFormatting': [
    ['auto', 'auto'],
    ['off', 'off'],
  ],
  'prettier.default-config.singleAttributePerLine': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-php.enabled': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-php.phpVersion': [
    ['5.0', '5.0'],
    ['5.1', '5.1'],
    ['5.2', '5.2'],
    ['5.3', '5.3'],
    ['5.4', '5.4'],
    ['5.5', '5.5'],
    ['5.6', '5.6'],
    ['7.0', '7.0'],
    ['7.1', '7.1'],
    ['7.2', '7.2'],
    ['7.3', '7.3'],
    ['7.4', '7.4'],
    ['8.0', '8.0'],
    ['8.1', '8.1'],
    ['8.2', '8.2'],
    ['8.3', '8.3'],
    ['8.4', '8.4'],
    ['8.5', '8.5'],
    ['auto', 'auto'],
  ],
  'prettier.plugins.prettier-plugin-php.useTabs': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-php.singleQuote': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-php.trailingCommaPHP': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-php.braceStyle': [
    ['per-cs', 'per-cs'],
    ['1tbs', '1tbs'],
  ],
  'prettier.plugins.prettier-plugin-php.requirePragma': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-php.insertPragma': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-xml.enabled': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-xml.bracketSameLine': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-xml.singleAttributePerLine': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-xml.xmlQuoteAttributes': [
    ['preserve', 'preserve'],
    ['double', 'double'],
    ['single', 'single'],
  ],
  'prettier.plugins.prettier-plugin-xml.xmlSelfClosingSpace': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-xml.xmlSortAttributesByKey': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-xml.xmlWhitespaceSensitivity': [
    ['strict', 'strict'],
    ['preserve', 'preserve'],
    ['ignore', 'ignore'],
  ],
  'prettier.plugins.prettier-plugin-astro.enabled': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-astro.astroAllowShorthand': [
    [true, 'Shorthand'],
    [false, 'Full Form'],
  ],
  'prettier.plugins.prettier-plugin-astro.astroSkipFrontmatter': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-astro.astroCompressHTML': [
    ['jsx', 'jsx'],
    ['html', 'html'],
    ['none', 'none'],
  ],
  'prettier.plugins.prettier-plugin-blade.enabled': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-blade.singleQuote': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-blade.wrapAttributes': [
    ['auto', 'auto'],
    ['force', 'force'],
    ['force-aligned', 'force-aligned'],
    ['force-expand-multiline', 'force-expand-multiline'],
    ['aligned-multiple', 'aligned-multiple'],
    ['preserve', 'preserve'],
    ['preserve-aligned', 'preserve-aligned'],
  ],
  'prettier.plugins.prettier-plugin-blade.endWithNewLine': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-blade.sortTailwindcssClasses': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-blade.sortHtmlAttributes': [
    ['none', 'none'],
    ['alphabetical', 'alphabetical'],
    ['code-guide', 'code-guide'],
    ['idiomatic', 'idiomatic'],
    ['vuejs', 'vuejs'],
    ['custom', 'custom'],
  ],
  'prettier.plugins.prettier-plugin-blade.noPhpSyntaxCheck': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-blade.indentInnerHtml': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-blade.trailingCommaPHP': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-blade.phpVersion': [
    ['5.0', '5.0'],
    ['5.1', '5.1'],
    ['5.2', '5.2'],
    ['5.3', '5.3'],
    ['5.4', '5.4'],
    ['5.5', '5.5'],
    ['5.6', '5.6'],
    ['7.0', '7.0'],
    ['7.1', '7.1'],
    ['7.2', '7.2'],
    ['7.3', '7.3'],
    ['7.4', '7.4'],
    ['8.0', '8.0'],
    ['8.1', '8.1'],
    ['8.2', '8.2'],
    ['8.3', '8.3'],
    ['8.4', '8.4'],
  ],
  'prettier.plugins.prettier-plugin-ejs.enabled': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-java.enabled': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-liquid.enabled': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-liquid.useTabs': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-liquid.singleQuote': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-liquid.bracketSameLine': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-liquid.liquidSingleQuote': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-liquid.embeddedSingleQuote': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-liquid.htmlWhitespaceSensitivity': [
    ['css', 'css'],
    ['strict', 'strict'],
    ['ignore', 'ignore'],
  ],
  'prettier.plugins.prettier-plugin-liquid.captureWhitespaceSensitivity': [
    ['strict', 'strict'],
    ['ignore', 'ignore'],
  ],
  'prettier.plugins.prettier-plugin-liquid.singleLineLinkTags': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-liquid.indentSchema': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-nginx.enabled': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-nginx.useTabs': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-nginx.alignDirectives': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-nginx.alignUniversally': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-nginx.wrapParameters': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-properties.enabled': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-properties.escapeNonLatin1': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-properties.keySeparator': [
    [' ', '" "'],
    [':', '":"'],
    ['=', '"="'],
    [': ', '": "'],
    ['= ', '"= "'],
    [' : ', '" : "'],
    [' = ', '" = "'],
  ],
  'prettier.plugins.prettier-plugin-sh.enabled': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-sh.variant': [
    ['bash', 'Bash'],
    ['posix', 'POSIX / sh'],
    ['mksh', 'mksh (Korn Shell)'],
    ['bats', 'Bats'],
    ['zsh', 'Zsh'],
  ],
  'prettier.plugins.prettier-plugin-sh.binaryNextLine': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-sh.switchCaseIndent': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-sh.spaceRedirects': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-sh.keepComments': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-sh.minify': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-sh.singleLine': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-sh.simplify': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-sh.functionNextLine': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-sql.enabled': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-sql.formatter': [
    ['auto', 'Auto-Detect'],
    ['sql-formatter', 'sql-formatter'],
    ['node-sql-parser', 'node-sql-parser'],
  ],
  'prettier.plugins.prettier-plugin-sql.sql-formatter.language': [
    ['auto', 'Auto-Detect'],
    ['bigquery', 'GCP BigQuery'],
    ['db2', 'IBM DB2'],
    ['db2i', 'IBM DB2i (experimental)'],
    ['hive', 'Apache Hive'],
    ['mariadb', 'MariaDB'],
    ['mysql', 'MySQL'],
    ['n1ql', 'Couchbase N1QL'],
    ['plsql', 'Oracle PL/SQL'],
    ['postgresql', 'PostgreSQL'],
    ['redshift', 'Amazon Redshift'],
    ['singlestoredb', 'SingleStoreDB'],
    ['snowflake', 'Snowflake'],
    ['spark', 'Spark'],
    ['sql', 'Generic SQL'],
    ['sqlite', 'SQLite'],
    ['transactsql', 'SQL Server Transact-SQL'],
    ['trino', 'Trino / Presto'],
    ['clickhouse', 'ClickHouse'],
  ],
  'prettier.plugins.prettier-plugin-sql.sql-formatter.keywordCase': [
    ['preserve', 'preserve'],
    ['upper', 'upper'],
    ['lower', 'lower'],
  ],
  'prettier.plugins.prettier-plugin-sql.sql-formatter.dataTypeCase': [
    ['preserve', 'preserve'],
    ['upper', 'upper'],
    ['lower', 'lower'],
  ],
  'prettier.plugins.prettier-plugin-sql.sql-formatter.functionCase': [
    ['preserve', 'preserve'],
    ['upper', 'upper'],
    ['lower', 'lower'],
  ],
  'prettier.plugins.prettier-plugin-sql.sql-formatter.identifierCase': [
    ['preserve', 'preserve'],
    ['upper', 'upper'],
    ['lower', 'lower'],
  ],
  'prettier.plugins.prettier-plugin-sql.sql-formatter.logicalOperatorNewline': [
    ['before', 'before'],
    ['after', 'after'],
  ],
  'prettier.plugins.prettier-plugin-sql.sql-formatter.denseOperators': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-sql.sql-formatter.newlineBeforeSemicolon': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-sql.node-sql-parser.database': [
    ['auto', 'Auto-Detect'],
    ['bigquery', 'GCP BigQuery'],
    ['db2', 'IBM DB2'],
    ['flinksql', 'FlinkSQL'],
    ['hive', 'Apache Hive'],
    ['mariadb', 'MariaDB'],
    ['mysql', 'MySQL'],
    ['postgresql', 'PostgreSQL'],
    ['snowflake', 'Snowflake'],
    ['transactsql', 'SQL Server Transact-SQL'],
  ],
  'prettier.plugins.prettier-plugin-sql.node-sql-parser.type': [
    ['table', 'table'],
    ['column', 'column'],
  ],
  'prettier.plugins.prettier-plugin-tailwind.enabled': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-tailwind.tailwindPreserveWhitespace': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-tailwind.tailwindPreserveDuplicates': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-tailwind.syntaxes.astro': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-tailwind.syntaxes.html': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-tailwind.syntaxes.html+ejs': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-tailwind.syntaxes.liquid-html': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-tailwind.syntaxes.javascript': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-tailwind.syntaxes.jsx': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-tailwind.syntaxes.tsx': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-tailwind.syntaxes.typescript': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-toml.enabled': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-toml.tomlVersion': [
    ['v1.0.0', 'v1.0.0'],
    ['v1.1.0', 'v1.1.0'],
    ['v1.1.0-preview', 'v1.1.0-preview'],
  ],
  'prettier.plugins.prettier-plugin-toml.keyValueEqualsSignAlignment': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-toml.trailingCommentAlignment': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-toml.indentSubTables': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-toml.indentTableKeyValuePairs': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-toml.commentStyle': [
    ['normalize', 'normalize'],
    ['preserve', 'preserve'],
  ],
  'prettier.plugins.prettier-plugin-toml.dateTimeDelimiter': [
    ['T', 'T'],
    ['space', 'space'],
    ['preserve', 'preserve'],
  ],
  'prettier.plugins.prettier-plugin-toml.stringQuoteStyle': [
    ['double', 'double'],
    ['single', 'single'],
    ['preserve', 'preserve'],
  ],
  'prettier.plugins.prettier-plugin-toml.keyQuoteStyle': [
    ['double', 'double'],
    ['single', 'single'],
    ['preserve', 'preserve'],
  ],
  'prettier.plugins.prettier-plugin-twig.enabled': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-twig.twigSingleQuote': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-twig.twigAlwaysBreakObjects': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-twig.twigFollowOfficialCodingStandards': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.plugins.prettier-plugin-twig.twigOutputEndblockName': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.format-on-save': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.format-on-save.ignore-without-config': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.format-on-save.ignore-remote': [
    [true, 'Enabled'],
    [false, 'Disabled'],
  ],
  'prettier.format-on-save.ignored-syntaxes.astro': [
    [false, 'Format on Save'],
    [true, 'Ignore'],
  ],
  'prettier.format-on-save.ignored-syntaxes.blade': [
    [false, 'Format on Save'],
    [true, 'Ignore'],
  ],
  'prettier.format-on-save.ignored-syntaxes.css': [
    [false, 'Format on Save'],
    [true, 'Ignore'],
  ],
  'prettier.format-on-save.ignored-syntaxes.flow': [
    [false, 'Format on Save'],
    [true, 'Ignore'],
  ],
  'prettier.format-on-save.ignored-syntaxes.graphql': [
    [false, 'Format on Save'],
    [true, 'Ignore'],
  ],
  'prettier.format-on-save.ignored-syntaxes.html': [
    [false, 'Format on Save'],
    [true, 'Ignore'],
  ],
  'prettier.format-on-save.ignored-syntaxes.html+ejs': [
    [false, 'Format on Save'],
    [true, 'Ignore'],
  ],
  'prettier.format-on-save.ignored-syntaxes.html+erb': [
    [false, 'Format on Save'],
    [true, 'Ignore'],
  ],
  'prettier.format-on-save.ignored-syntaxes.liquid-html': [
    [false, 'Format on Save'],
    [true, 'Ignore'],
  ],
  'prettier.format-on-save.ignored-syntaxes.java': [
    [false, 'Format on Save'],
    [true, 'Ignore'],
  ],
  'prettier.format-on-save.ignored-syntaxes.java-properties': [
    [false, 'Format on Save'],
    [true, 'Ignore'],
  ],
  'prettier.format-on-save.ignored-syntaxes.javascript': [
    [false, 'Format on Save'],
    [true, 'Ignore'],
  ],
  'prettier.format-on-save.ignored-syntaxes.json': [
    [false, 'Format on Save'],
    [true, 'Ignore'],
  ],
  'prettier.format-on-save.ignored-syntaxes.jsx': [
    [false, 'Format on Save'],
    [true, 'Ignore'],
  ],
  'prettier.format-on-save.ignored-syntaxes.less': [
    [false, 'Format on Save'],
    [true, 'Ignore'],
  ],
  'prettier.format-on-save.ignored-syntaxes.markdown': [
    [false, 'Format on Save'],
    [true, 'Ignore'],
  ],
  'prettier.format-on-save.ignored-syntaxes.liquid-md': [
    [false, 'Format on Save'],
    [true, 'Ignore'],
  ],
  'prettier.format-on-save.ignored-syntaxes.nginx': [
    [false, 'Format on Save'],
    [true, 'Ignore'],
  ],
  'prettier.format-on-save.ignored-syntaxes.php': [
    [false, 'Format on Save'],
    [true, 'Ignore'],
  ],
  'prettier.format-on-save.ignored-syntaxes.scss': [
    [false, 'Format on Save'],
    [true, 'Ignore'],
  ],
  'prettier.format-on-save.ignored-syntaxes.sql': [
    [false, 'Format on Save'],
    [true, 'Ignore'],
  ],
  'prettier.format-on-save.ignored-syntaxes.toml': [
    [false, 'Format on Save'],
    [true, 'Ignore'],
  ],
  'prettier.format-on-save.ignored-syntaxes.tsx': [
    [false, 'Format on Save'],
    [true, 'Ignore'],
  ],
  'prettier.format-on-save.ignored-syntaxes.typescript': [
    [false, 'Format on Save'],
    [true, 'Ignore'],
  ],
  'prettier.format-on-save.ignored-syntaxes.twig': [
    [false, 'Format on Save'],
    [true, 'Ignore'],
  ],
  'prettier.format-on-save.ignored-syntaxes.vue': [
    [false, 'Format on Save'],
    [true, 'Ignore'],
  ],
  'prettier.format-on-save.ignored-syntaxes.xml': [
    [false, 'Format on Save'],
    [true, 'Ignore'],
  ],
  'prettier.format-on-save.ignored-syntaxes.yaml': [
    [false, 'Format on Save'],
    [true, 'Ignore'],
  ],
}

module.exports = { WORKSPACE_CHOICES }
