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

/**
 * Determines the appropriate SQL dialect for sql-formatter based on file extension.
 *
 * @param {string} uri  The document URI (e.g., editor.document.uri)
 * @returns {string}    One of the supported sql-formatter dialects (e.g. 'postgresql', 'sqlite', 'tsql')
 *
 * Falls back to 'sql' if no specific dialect match is found.
 * Uses the longest matching extension to ensure precision (e.g. '.mariadb.sql' before '.sql').
 */
function getSqlDialectFromUri(uri) {
  const path = extractPath(uri).toLowerCase()
  for (const ext of sortedSqlExtensions) {
    if (path.endsWith(ext)) {
      return extToSqlDialect[ext]
    }
  }
  log.debug(
    `No matching SQL dialect found for URI: ${uri}, falling back to 'sql'`,
  )
  return 'sql' // fallback default
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
 * Resolves the SQL dialect to use with node-sql-parser based on file extension.
 * Falls back to 'mysql' if the detected dialect is not supported.
 *
 * @param {string} uri  The document URI
 * @returns {string}    A safe dialect for node-sql-parser
 */
function getSqlParserDialect(uri) {
  let dialect = getSqlDialectFromUri(uri)
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
  getSqlDialectFromUri,
  getSqlParserDialect,
}
