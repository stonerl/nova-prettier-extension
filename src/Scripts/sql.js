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

const { extractPath, log } = require('./helpers.js')

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

// Sorted SQL extensions (longest first) to ensure precise matching
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
  hiveql: 'hive',
  flinksql: 'flinksql',
  bigquery: 'bigquery',
  tsql: 'tsql',
  trino: 'trino',
  sqlpl: 'db2',
  sqlite: 'sqlite',
  'sql-generic': 'sql', // maps sql-generic to sql
}

// Use this map for syntax detection or processing
function getMappedSqlDialect(dialect) {
  return sqlExtensionSyntaxMap[dialect] || 'sql' // fallback to 'sql' if not found
}

/**
 * Determines the appropriate SQL dialect for sql-formatter based on the file extension
 * or the provided syntax.
 *
 * If a valid `syntax` is provided, it will be mapped directly to the corresponding SQL dialect.
 * If no valid `syntax` is provided, the function will resolve the dialect based on the file extension.
 *
 * @param {string} uri  The document URI (e.g., editor.document.uri)
 * @param {string} [syntax=null] The SQL syntax detected by the SQL extension, if available.
 *                               If provided, the function will map it directly to the appropriate SQL dialect.
 * @returns {string}    One of the supported sql-formatter dialects (e.g., 'postgresql', 'sqlite', 'tsql')
 *
 * If a valid syntax is provided, it will be mapped directly.
 * If no syntax is provided or the syntax is 'sql' (default), the function will resolve the dialect based on the file extension,
 * using the longest matching extension (e.g., '.mariadb.sql' before '.sql').
 */
function getSqlDialectFromUriOrSyntax(uri, syntax = null) {
  if (syntax && sqlExtensionSyntaxMap[syntax]) {
    // If a valid mapped syntax is provided, return it directly
    return sqlExtensionSyntaxMap[syntax]
  }

  // If no valid syntax provided, resolve based on URI
  const path = extractPath(uri).toLowerCase()
  for (const ext of sortedSqlExtensions) {
    if (path.endsWith(ext)) {
      return extToSqlDialect[ext]
    }
  }

  log.debug(
    `No matching SQL dialect found for URI: ${uri}, falling back to 'sql'`,
  )
  return 'sql' // Fallback to 'sql' if no match is found
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
 * Resolves the SQL dialect to use with node-sql-parser based on file extension or provided syntax.
 * Falls back to 'mysql' if the detected dialect is not supported by node-sql-parser.
 *
 * If a valid `syntax` is provided, it will be mapped directly to the corresponding SQL dialect.
 * If no valid `syntax` is provided, the function will resolve the dialect based on the file extension.
 *
 * @param {string} uri    The document URI (e.g., editor.document.uri)
 * @param {string} [syntax=null]  The SQL syntax detected by the SQL extension, if available.
 *                                If provided, the function will map it directly to the appropriate SQL dialect.
 * @returns {string}      A safe dialect for node-sql-parser, either a supported SQL dialect or 'mysql' as a fallback
 */
function getSqlParserDialect(uri, syntax = null) {
  let dialect = getSqlDialectFromUriOrSyntax(uri, syntax)
  dialect = normalizeForSqlParser(dialect)

  if (!isSqlParserDialect(dialect)) {
    log.debug(
      `Dialect '${dialect}' not supported by node-sql-parser — falling back to 'mysql'`,
    )
    return 'mysql'
  }

  return dialect
}

module.exports = {
  getSqlDialectFromUriOrSyntax,
  getSqlParserDialect,
}
