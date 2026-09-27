/**
 * sql-dialects.test.js — Unit tests for SQL syntax normalization and
 * dialect resolution
 *
 * @license MIT
 * @author Toni Förster
 * @copyright © 2026 Toni Förster
 *
 * Plain Node script — no test framework. Exits non-zero on failure.
 *
 * Verifies that
 *   • every SQL-dialect syntax reported by the SQL Language Extension
 *     (including the explicit `mariadb` syntax) normalizes to the `sql`
 *     plugin key, both via the syntax and the file extension path,
 *   • the sql-formatter dialect resolver maps the `mariadb` syntax and
 *     the `.mariadb.sql` extension to the `mariadb` dialect while the
 *     neighboring dialects keep their mappings, and
 *   • the node-sql-parser resolver accepts `mariadb` directly (it is a
 *     supported dialect and must not fall back to `mysql`).
 *
 * Stubs global.nova so the modules can be required outside Nova.
 */

const path = require('path')
const fs = require('fs')

const SRC_DIR = fs.realpathSync(
  process.env.SQL_DIALECTS_SRC || path.join(__dirname, '..', 'src', 'Scripts'),
)

let failed = 0
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`)
  if (!ok) {
    failed++
    if (detail !== undefined) {
      console.log(` → ${JSON.stringify(detail, null, 2).slice(0, 800)}`)
    }
  }
}

/**
 * Minimal Nova shim. Only what syntax.js/sql.js touch at call time:
 * workspace/extension config lookups and debug-log gating. Config keys
 * fall through a table; unset keys read as null (Nova's unset value).
 * The advanced-detection flag must read true, matching the shipped
 * configuration default.
 */
function makeNovaShim(configValues = {}) {
  const get = (name) =>
    Object.prototype.hasOwnProperty.call(configValues, name)
      ? configValues[name]
      : null
  return {
    inDevMode: () => false,
    config: { get },
    workspace: { config: { get }, path: null },
  }
}

function loadModules() {
  global.nova = makeNovaShim({ 'prettier.syntax.advancedDetection': true })

  for (const file of [
    'helpers.js',
    'notifications.js',
    'sql.js',
    'syntax.js',
  ]) {
    delete require.cache[path.join(SRC_DIR, file)]
  }

  return {
    syntax: require(path.join(SRC_DIR, 'syntax.js')),
    sql: require(path.join(SRC_DIR, 'sql.js')),
  }
}

function mariadbSyntaxNormalizesToSqlPluginKey() {
  console.log('\n== MariaDB syntax normalizes to the sql plugin key ==')

  const { syntax } = loadModules()

  check(
    'Nova-reported mariadb syntax maps to "sql"',
    syntax.detectSyntax({ syntax: 'mariadb', uri: 'file:///w/query.sql' }) ===
      'sql',
  )

  // The extension-based path must agree: a .mariadb.sql file is sql even
  // when Nova reports no dialect-specific syntax.
  check(
    '.mariadb.sql file resolves to "sql"',
    syntax.detectSyntax({ syntax: null, uri: 'file:///w/db.mariadb.sql' }) ===
      'sql',
  )

  // Sanity check that the surrounding SQL dialects still normalize.
  for (const alias of ['mysql', 'postgresql', 'tsql', 'sql-generic']) {
    check(
      `"${alias}" still maps to "sql"`,
      syntax.detectSyntax({ syntax: alias, uri: 'file:///w/query.sql' }) ===
        'sql',
    )
  }

  // Non-SQL syntaxes must pass through untouched.
  check(
    'non-SQL syntax is not swallowed by the SQL branch',
    syntax.detectSyntax({ syntax: 'javascript', uri: 'file:///w/index.js' }) ===
      'javascript',
  )
}

function dialectResolutionForSqlFormatter() {
  console.log('\n== sql-formatter dialect resolution ==')

  const { sql } = loadModules()

  check(
    'mariadb syntax maps to the mariadb dialect',
    sql.getSqlDialectFromUriOrSyntax('file:///w/db.mariadb.sql', 'mariadb') ===
      'mariadb',
  )

  check(
    '.mariadb.sql extension maps to the mariadb dialect without a syntax',
    sql.getSqlDialectFromUriOrSyntax('file:///w/db.mariadb.sql', null) ===
      'mariadb',
  )

  // Longest-suffix ordering must beat the bare .sql mapping.
  check(
    '.mariadb.sql outranks plain .sql',
    sql.getSqlDialectFromUriOrSyntax('file:///w/db.mariadb.sql', null) !==
      'sql',
  )

  for (const [syntax, dialect] of [
    ['mysql', 'mysql'],
    ['postgresql', 'postgresql'],
    ['hiveql', 'hive'],
    ['tsql', 'tsql'],
    ['sql-generic', 'sql'],
  ]) {
    check(
      `"${syntax}" still resolves to "${dialect}"`,
      sql.getSqlDialectFromUriOrSyntax('file:///w/query.sql', syntax) ===
        dialect,
    )
  }

  check(
    'plain .sql file falls back to the sql dialect',
    sql.getSqlDialectFromUriOrSyntax('file:///w/query.sql', null) === 'sql',
  )
}

function dialectResolutionForNodeSqlParser() {
  console.log('\n== node-sql-parser dialect resolution ==')

  const { sql } = loadModules()

  check(
    'mariadb syntax resolves directly (no mysql fallback)',
    sql.getSqlParserDialect('file:///w/db.mariadb.sql', 'mariadb') ===
      'mariadb',
  )

  check(
    'mariadb extension resolves directly without a syntax',
    sql.getSqlParserDialect('file:///w/db.mariadb.sql', null) === 'mariadb',
  )

  check(
    'tsql normalizes to transactsql for node-sql-parser',
    sql.getSqlParserDialect('file:///w/query.sql', 'tsql') === 'transactsql',
  )

  check(
    'generic sql silently falls back to mysql (everyday case, no mismatch)',
    sql.getSqlParserDialect('file:///w/query.sql', null) === 'mysql',
  )

  check(
    'unsupported distinct dialect resolves to null (formatting skipped)',
    sql.getSqlParserDialect('file:///w/query.n1ql', null) === null,
  )

  check(
    'plsql resolves to null for node-sql-parser',
    sql.getSqlParserDialect('file:///w/query.plsql', 'plsql') === null,
  )
}

function dialectFormatterCrossSupport() {
  console.log('\n== dialect/formatter cross-support ==')

  const { sql } = loadModules()

  check(
    'flinksql is not supported by sql-formatter (would crash prettier)',
    sql.dialectSupportedBy('sql-formatter', 'flinksql') === false,
  )

  check(
    'flinksql is supported by node-sql-parser',
    sql.dialectSupportedBy('node-sql-parser', 'flinksql') === true,
  )

  for (const dialect of ['mariadb', 'mysql', 'postgresql', 'tsql', 'db2']) {
    check(
      `"${dialect}" is supported by both formatters`,
      sql.dialectSupportedBy('sql-formatter', dialect) === true &&
        sql.dialectSupportedBy('node-sql-parser', dialect) === true,
    )
  }

  for (const dialect of [
    'sqlite',
    'plsql',
    'n1ql',
    'trino',
    'redshift',
    'singlestoredb',
    'spark',
    'db2i',
  ]) {
    check(
      `"${dialect}" is sql-formatter-only (node-sql-parser would misformat it)`,
      sql.dialectSupportedBy('sql-formatter', dialect) === true &&
        sql.dialectSupportedBy('node-sql-parser', dialect) === false,
    )
  }

  check(
    'generic sql is handled by node-sql-parser via the mysql fallback',
    sql.dialectSupportedBy('node-sql-parser', 'sql') === true,
  )

  // Union completeness: every dialect the resolver can emit must be
  // supported by at least one formatter — no dead-end dialects.
  const emittedDialects = [
    'sql',
    'tsql',
    'postgresql',
    'mysql',
    'mariadb',
    'hive',
    'plsql',
    'db2',
    'db2i',
    'sqlite',
    'bigquery',
    'snowflake',
    'redshift',
    'trino',
    'singlestoredb',
    'spark',
    'n1ql',
    'flinksql',
  ]
  const deadEnds = emittedDialects.filter(
    (d) =>
      !sql.dialectSupportedBy('sql-formatter', d) &&
      !sql.dialectSupportedBy('node-sql-parser', d),
  )
  check(
    'no emitted dialect is unsupported by both formatters',
    deadEnds.length === 0,
    deadEnds,
  )
}

function autoFormatterRouting() {
  console.log('\n== auto formatter routing ==')

  const { sql } = loadModules()

  check(
    'flinksql routes to node-sql-parser',
    sql.resolveSqlFormatter('flinksql') === 'node-sql-parser',
  )

  for (const dialect of ['sql', 'mariadb', 'plsql', 'trino', 'spark']) {
    check(
      `"${dialect}" routes to sql-formatter (preferred)`,
      sql.resolveSqlFormatter(dialect) === 'sql-formatter',
    )
  }

  check(
    'unknown dialect routes to null (dead end)',
    sql.resolveSqlFormatter('not-a-dialect') === null,
  )

  // Routing must agree with the support matrix for every emitted dialect.
  const emittedDialects = [
    'sql',
    'tsql',
    'postgresql',
    'mysql',
    'mariadb',
    'hive',
    'plsql',
    'db2',
    'db2i',
    'sqlite',
    'bigquery',
    'snowflake',
    'redshift',
    'trino',
    'singlestoredb',
    'spark',
    'n1ql',
    'flinksql',
  ]
  const unroutable = emittedDialects.filter(
    (d) => sql.resolveSqlFormatter(d) === null,
  )
  check(
    'every emitted dialect routes to a formatter',
    unroutable.length === 0,
    unroutable,
  )
}

async function main() {
  mariadbSyntaxNormalizesToSqlPluginKey()
  dialectResolutionForSqlFormatter()
  dialectResolutionForNodeSqlParser()
  dialectFormatterCrossSupport()
  autoFormatterRouting()

  console.log(
    `\n${failed === 0 ? 'All checks passed.' : `${failed} check(s) failed.`}`,
  )
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
