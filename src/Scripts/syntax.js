/**
 * syntax.js — Language syntax detection module for Prettier⁺ extension for Nova
 *
 * @license MIT
 * @author Toni Förster
 * @copyright © 2025 Toni Förster
 *
 * Inspects Nova’s `document.syntax` and the document URI’s file extension
 * to determine the true language key for each document, ensuring the
 * appropriate parser is selected for Blade, Java, Tailwind, GraphQL,
 * Vue, SQL, Nginx, YAML, Flow, and all other supported syntaxes.
 * Honors the `prettier.syntax.advancedDetection` config flag—if set to
 * false, will simply return Nova’s `document.syntax` unchanged.
 */

const { extractPath, getConfigWithWorkspaceOverride } = require('./helpers.js')

// 1) Map file‑name suffixes (longest first) to internal language keys
const extToSyntax = {
  // Astro
  '.astro': 'astro',

  // Blade templates
  '.blade.php': 'blade',

  // Liquid variants
  '.liquid': 'liquid-html', // plain .liquid → HTML flavor
  '.liquid.md': 'liquid-md', // Liquid in Markdown
  '.liquid.html': 'liquid-html', // Liquid in HTML

  // Embedded HTML templates
  '.html.ejs': 'html+ejs',
  '.html.erb': 'html+erb',
  '.ejs': 'html+ejs',
  '.erb': 'html+erb',
  '.html': 'html',
  '.htm': 'html',

  // Flow (optional suffix cases)
  '.flow.js': 'flow',
  '.flow.jsx': 'flow',

  // GraphQL
  '.graphql': 'graphql',
  '.gql': 'graphql',
  '.gqls': 'graphql', // GraphQL schema (unofficial, rare)
  '.graphqls': 'graphql', // GraphQL schema files (rare)

  // JS / TS ecosystem
  '.tsx': 'tsx',
  '.cts': 'typescript',
  '.mts': 'typescript',
  '.ts': 'typescript',
  '.jsx': 'jsx',
  '.cjs': 'javascript',
  '.mjs': 'javascript',
  '.js': 'javascript',

  // Styling
  '.css': 'css',
  '.less': 'less',
  '.scss': 'scss',

  // PHP
  '.php': 'php',
  '.phtml': 'php',

  // Java & Properties
  '.java': 'java',
  '.properties': 'java-properties',

  // JSON & YAML
  '.json5': 'json',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.yaml.tmpl': 'yaml', // Helm templates, commonly used in Kubernetes

  // SQL – Standard and extended dialects
  '.sql': 'sql', // Standard SQL files
  '.ddl': 'sql', // Data Definition Language
  '.tsql': 'sql', // Transact-SQL (SQL Server)
  '.psql': 'sql', // PostgreSQL SQL scripts (alias)
  '.pgsql': 'sql', // PostgreSQL (PLpgSQL)
  '.mysql': 'sql', // MySQL scripts
  '.hqsql': 'sql', // Hive Query Language (non-standard alias)
  '.hql': 'sql', // HiveQL standard extension
  '.q': 'sql', // HiveQL query files

  // PLSQL – Oracle PL/SQL
  '.pls': 'sql', // PL/SQL source file
  '.bdy': 'sql', // Package body
  '.fnc': 'sql', // Function
  '.pck': 'sql', // Package
  '.pkb': 'sql', // Package body
  '.pks': 'sql', // Package specification
  '.plb': 'sql', // Library
  '.plsql': 'sql', // Generic PL/SQL file
  '.prc': 'sql', // Procedure
  '.spc': 'sql', // Specification
  '.tpb': 'sql', // Trigger body
  '.tps': 'sql', // Trigger spec
  '.trg': 'sql', // Trigger
  '.vw': 'sql', // View

  // SQLPL – DB2 SQL Procedural Language
  '.db2': 'sql', // IBM DB2 SQL
  '.cql': 'sql', // Cassandra Query Language
  '.inc': 'sql', // SQL include files
  '.tab': 'sql', // Table definitions
  '.udf': 'sql', // User-defined function
  '.viw': 'sql', // View

  // Extended dialects – for full support
  '.sqlite': 'sql', // SQLite
  '.sqlite3': 'sql', // SQLite v3
  '.bq': 'sql', // BigQuery shorthand
  '.bigquery': 'sql', // BigQuery
  '.sf.sql': 'sql', // Snowflake
  '.rs.sql': 'sql', // Redshift
  '.trino.sql': 'sql', // Trino
  '.singlestore.sql': 'sql', // SingleStoreDB (formerly MemSQL)
  '.spark.sql': 'sql', // Spark SQL
  '.n1ql': 'sql', // Couchbase N1QL
  '.mariadb.sql': 'sql', // MariaDB
  '.db2i': 'sql', // IBM DB2i (experimental)
  '.flink.sql': 'sql', //FlinkSQL
  '.flinksql': 'sql', //FlinkSQL

  // XML
  '.xml': 'xml',
  '.xsd': 'xml',
  '.xsl': 'xml',
  '.rss': 'xml',

  // Nginx
  '.nginx': 'nginx',
  '.nginxconf': 'nginx',

  // Markdown
  '.markdown': 'markdown',
  '.md': 'markdown',

  // Vue Single‑File Components
  '.vue': 'vue',
}

// 2) Pre‑sorted list of extensions by length (descending), so longest match wins first.
//    Prevents false positives like ".php" matching ".blade.php" files.
const sortedExtensions = Object.keys(extToSyntax).sort(
  (a, b) => b.length - a.length,
)

// 3) Nova’s built‑in syntax keys we explicitly support
const knownSyntaxKeys = new Set([
  'astro',
  'blade',
  'liquid-md',
  'liquid-html',
  'html+erb',
  'html+ejs',
  'html',
  'javascript',
  'typescript',
  'jsx',
  'tsx',
  'flow',
  'graphql',
  'css',
  'less',
  'scss',
  'php',
  'java',
  'java-properties',
  'json',
  'yaml',
  'markdown',
  'sql',
  'xml',
  'nginx',
  'vue',
])

/**
 * Determine the true syntax key for a document.
 *
 * @param {object} opts
 * @param {string} opts.syntax  the value of editor.document.syntax
 * @param {string} opts.uri     the value of editor.document.uri
 * @returns {string}            one of your internal syntax keys
 */
function detectSyntax({ syntax, uri }) {
  // Read the user’s “advanced detection” setting (default: true)
  const advancedDetection = getConfigWithWorkspaceOverride(
    'prettier.syntax.advancedDetection',
  )

  // If the user disabled it, trust Nova entirely
  if (!advancedDetection) {
    return syntax
  }

  // 0) Astro and Liquid exceptions: if Nova got it right, trust it immediately
  if (
    syntax === 'astro' ||
    syntax === 'liquid-md' ||
    syntax === 'liquid-html'
  ) {
    return syntax
  }

  // 1) Extension‑based detection (longest suffix first)
  const path = extractPath(uri).toLowerCase()
  for (const ext of sortedExtensions) {
    if (path.endsWith(ext)) {
      return extToSyntax[ext]
    }
  }

  // 2) If Nova’s syntax matches one we support, use that
  if (knownSyntaxKeys.has(syntax)) {
    return syntax
  }

  // 3) Otherwise give Nova’s value back
  return syntax
}

module.exports = { detectSyntax }
