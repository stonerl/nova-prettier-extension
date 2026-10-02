/**
 * sql.js — SQL dialect detection module for Prettier⁺ extension for Nova
 *
 * @license MIT
 * @author Toni Förster
 * @copyright © 2025 Toni Förster
 *
 * Maps known SQL-related file extensions to specific dialects supported
 * by sql-formatter, including PostgreSQL, SQLite, Hive, T-SQL, PL/SQL,
 * Trino, Snowflake, and more. Ensures that dialect-specific formatting
 * is applied where applicable. Also includes fallback logic to default
 * to 'sql' when no specific dialect is detected.
 */

const { extractPath, log } = require('../helpers.js')

// SQL dialect mapping for sql-formatter
const extToSqlDialect = {
  '.sql': 'sql',
  '.ddl': 'sql',
  '.tsql': 'tsql',
  '.psql': 'postgresql',
  '.pgsql': 'postgresql',
  '.mysql': 'mysql',
  '.mariadb.sql': 'mariadb',
  '.hqsql': 'hive',
  '.hql': 'hive',
  '.q': 'hive',

  // Oracle PL/SQL
  '.pls': 'plsql',
  '.bdy': 'plsql',
  '.fnc': 'plsql',
  '.pck': 'plsql',
  '.pkb': 'plsql',
  '.pks': 'plsql',
  '.plb': 'plsql',
  '.plsql': 'plsql',
  '.prc': 'plsql',
  '.spc': 'plsql',
  '.tpb': 'plsql',
  '.tps': 'plsql',
  '.trg': 'plsql',
  '.vw': 'plsql',

  // IBM DB2 & DB2i
  '.db2': 'db2',
  '.db2i': 'db2i',

  // Other dialects
  '.sqlite': 'sqlite',
  '.sqlite3': 'sqlite',
  '.bq': 'bigquery',
  '.bigquery': 'bigquery',
  '.sf.sql': 'snowflake',
  '.rs.sql': 'redshift',
  '.trino.sql': 'trino',
  '.singlestore.sql': 'singlestoredb',
  '.spark.sql': 'spark',
  '.n1ql': 'n1ql',
  '.flink.sql': 'flinksql',
  '.flinksql': 'flinksql',
}

// Sorted SQL extensions (longest first) for precise matching
const sortedSqlExtensions = Object.keys(extToSqlDialect).sort(
  (a, b) => b.length - a.length,
)

// Maps the SQL syntax reported by the SQL extension to the internal dialect names
const sqlExtensionSyntaxMap = {
  sparksql: 'spark',
  snowflake: 'snowflake',
  singlestore: 'singlestoredb',
  redshift: 'redshift',
  postgresql: 'postgresql',
  plsql: 'plsql',
  mysql: 'mysql',
  mariadb: 'mariadb',
  hiveql: 'hive',
  flinksql: 'flinksql',
  bigquery: 'bigquery',
  tsql: 'tsql',
  trino: 'trino',
  sqlpl: 'db2',
  sqlite: 'sqlite',
  'sql-generic': 'sql',
}

/**
 * Determines the appropriate SQL dialect for sql-formatter based on the
 * file extension or the provided syntax.
 *
 * A valid mapped `syntax` is used directly; otherwise the dialect is
 * resolved from the URI, longest matching extension first (e.g.
 * '.mariadb.sql' before '.sql').
 *
 * @param {string} uri  The document URI (e.g., editor.document.uri)
 * @param {string} [syntax=null] The SQL syntax detected by the SQL extension, if available.
 * @returns {string}    One of the supported sql-formatter dialects (e.g., 'postgresql', 'sqlite', 'tsql')
 */
function getSqlDialectFromUriOrSyntax(uri, syntax = null) {
  if (syntax && sqlExtensionSyntaxMap[syntax]) {
    return sqlExtensionSyntaxMap[syntax]
  }

  const path = extractPath(uri).toLowerCase()
  for (const ext of sortedSqlExtensions) {
    if (path.endsWith(ext)) {
      return extToSqlDialect[ext]
    }
  }

  log.debug(
    `No matching SQL dialect found for URI: ${uri}, falling back to 'sql'`,
  )
  return 'sql'
}

// Dialects supported by node-sql-parser (used to validate dialect compatibility)
const supportedSqlParserDialects = new Set([
  'bigquery',
  'db2',
  'hive',
  'mariadb',
  'mysql',
  'postgresql',
  'transactsql',
  'flinksql',
  'snowflake',
])

/**
 * Checks whether a given SQL dialect is supported by node-sql-parser.
 *
 * @param {string} dialect  The SQL dialect string (e.g. 'mysql', 'postgresql')
 * @returns {boolean}       True if supported by node-sql-parser, false otherwise
 */
function isSqlParserDialect(dialect) {
  return supportedSqlParserDialects.has(dialect)
}

// Dialects accepted by prettier-plugin-sql's `language` option for the
// sql-formatter implementation (mirrors the plugin's own choice enum;
// notably it does NOT include 'flinksql').
const sqlFormatterDialects = new Set([
  'sql',
  'bigquery',
  'clickhouse',
  'db2',
  'db2i',
  'hive',
  'mariadb',
  'mysql',
  'n1ql',
  'plsql',
  'postgresql',
  'redshift',
  'singlestoredb',
  'snowflake',
  'spark',
  'sqlite',
  'transactsql',
  'tsql',
  'trino',
])

/**
 * Checks whether a SQL formatter implementation can handle a detected
 * dialect. Used to guard the auto-detected dialect before it reaches
 * prettier's option validation, so unsupported combinations surface as
 * a friendly notification instead of a raw prettier error.
 *
 * For node-sql-parser, generic 'sql' counts as supported because it is
 * the everyday case and falls back to the closest dialect ('mysql').
 *
 * @param {'sql-formatter'|'node-sql-parser'} formatter  Formatter implementation
 * @param {string} dialect  The detected SQL dialect (e.g. 'mariadb', 'flinksql')
 * @returns {boolean}       True if the formatter can format this dialect
 */
function dialectSupportedBy(formatter, dialect) {
  if (formatter === 'sql-formatter') {
    return sqlFormatterDialects.has(dialect)
  }
  if (formatter === 'node-sql-parser') {
    if (dialect === 'sql') return true
    return isSqlParserDialect(normalizeForSqlParser(dialect))
  }
  return false
}

/**
 * Routes a detected SQL dialect to the formatter implementation that can
 * handle it. sql-formatter is preferred (it covers most dialects);
 * node-sql-parser is the fallback for dialects sql-formatter rejects,
 * such as 'flinksql'.
 *
 * Returns null only when no formatter supports the dialect — a dead end
 * that the cross-support test suite guards against.
 *
 * @param {string} dialect  The detected SQL dialect (e.g. 'mariadb', 'flinksql')
 * @returns {'sql-formatter'|'node-sql-parser'|null}
 */
function resolveSqlFormatter(dialect) {
  if (sqlFormatterDialects.has(dialect)) {
    return 'sql-formatter'
  }
  return isSqlParserDialect(normalizeForSqlParser(dialect))
    ? 'node-sql-parser'
    : null
}

/**
 * Normalizes dialects for compatibility with node-sql-parser.
 * Maps alternative or shorthand values to their accepted form.
 *
 * @param {string} dialect The dialect detected from file extension
 * @returns {string}       A normalized dialect name for node-sql-parser
 */
function normalizeForSqlParser(dialect) {
  if (dialect === 'tsql') return 'transactsql'
  return dialect
}

/**
 * Resolves the SQL dialect to use with node-sql-parser based on file
 * extension or provided syntax. Returns null if the detected dialect is
 * not supported by node-sql-parser.
 *
 * Generic 'sql' falls back to 'mysql', the closest supported dialect —
 * the everyday case, not a mismatch.
 *
 * @param {string} uri    The document URI (e.g. editor.document.uri)
 * @param {string} [syntax=null]  The SQL syntax detected by the SQL extension, if available.
 *                                If provided, the function will map it directly to the appropriate SQL dialect.
 * @returns {string|null} A safe dialect for node-sql-parser, or null when the dialect is unsupported
 */
function getSqlParserDialect(uri, syntax = null) {
  let dialect = getSqlDialectFromUriOrSyntax(uri, syntax)
  dialect = normalizeForSqlParser(dialect)

  if (!isSqlParserDialect(dialect)) {
    if (dialect === 'sql') {
      return 'mysql'
    }

    log.debug(
      `Dialect '${dialect}' not supported by node-sql-parser — formatting skipped`,
    )
    return null
  }

  return dialect
}

module.exports = {
  getSqlDialectFromUriOrSyntax,
  getSqlParserDialect,
  dialectSupportedBy,
  resolveSqlFormatter,
}
