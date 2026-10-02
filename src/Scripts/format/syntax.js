/**
 * syntax.js — Language syntax detection module for Prettier⁺ extension for Nova
 *
 * @license MIT
 * @author Toni Förster
 * @copyright © 2025 Toni Förster
 *
 * Inspects Nova’s `document.syntax`, the document URI’s file extension,
 * and the URI’s basename to determine the true language key for each
 * document, ensuring the appropriate parser is selected for Blade, Java,
 * Tailwind, GraphQL, Vue, SQL, Nginx, YAML, Flow, Shell, Dockerfile, and
 * all other supported syntaxes.
 * Honors the `prettier.syntax.advancedDetection` config flag—if set to
 * false, will simply return Nova’s `document.syntax` unchanged.
 */

const { extractPath, getConfigWithWorkspaceOverride } = require('../helpers.js')

// Map file-name suffixes (longest first) to internal language keys
const extToSyntax = {
  // Astro
  '.astro': 'astro',

  // Blade templates
  '.blade.php': 'blade',

  // Liquid variants
  '.liquid': 'liquid-html', // plain .liquid → HTML flavor
  '.liquid.md': 'liquid-md',
  '.liquid.html': 'liquid-html',

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
  '.gqls': 'graphql', // schema (unofficial, rare)
  '.graphqls': 'graphql', // schema (rare)

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

  // Shell (prettier-plugin-sh) – extensions
  '.sh': 'sh',
  '.bash': 'sh',
  '.zsh': 'sh',
  '.bats': 'sh',
  '.ksh': 'sh',
  '.csh': 'sh',
  '.tcsh': 'sh',
  '.command': 'sh',
  '.tmux': 'sh',
  '.zsh-theme': 'sh',
  '.ebuild': 'sh',
  '.eclass': 'sh',
  '.nu': 'sh', // Nushell
  '.cgi': 'sh', // shebang scripts
  '.fcgi': 'sh',
  '.sbatch': 'sh', // HPC / Slurm batch scripts
  '.slurm': 'sh',
  '.sh.in': 'sh', // autoconf templates
  '.tool': 'sh',
  '.trigger': 'sh',
  '.ics': 'sh', // iCalendar
  '.ical': 'sh',
  '.pc': 'sh', // pkg-config
  '.pc.in': 'sh',
  '.vcf': 'sh', // vCard

  // Shell – rc files and dotfile scripts (suffix match)
  '.bashrc': 'sh',
  '.bash_profile': 'sh',
  '.bash_aliases': 'sh',
  '.zshrc': 'sh',
  '.zprofile': 'sh',
  '.zshenv': 'sh',
  '.profile': 'sh',
  '.envrc': 'sh',

  // Ignore and attribute lists (parsed as shell by prettier-plugin-sh)
  '.gitignore': 'sh',
  '.eslintignore': 'sh',
  '.prettierignore': 'sh',
  '.npmignore': 'sh',
  '.dockerignore': 'sh',
  '.ignore': 'sh',
  '.gitattributes': 'sh',

  // Env, nvm, JVM options
  '.env': 'sh',
  '.nvmrc': 'sh',
  '.node-version': 'sh',
  '.vmoptions': 'sh',

  // Docker (prettier-plugin-sh)
  '.dockerfile': 'dockerfile',
  '.containerfile': 'dockerfile',
  dockerfile: 'dockerfile', // bare `Dockerfile` filename
  containerfile: 'dockerfile', // bare `Containerfile` filename

  // Java & Properties
  '.java': 'java',
  '.properties': 'java-properties',

  // JSON & YAML
  '.json5': 'json',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.yaml.tmpl': 'yaml', // Helm templates

  // SQL – standard and extended dialects
  '.sql': 'sql',
  '.ddl': 'sql', // Data Definition Language
  '.tsql': 'sql', // Transact-SQL (SQL Server)
  '.psql': 'sql', // PostgreSQL scripts (alias)
  '.pgsql': 'sql', // PostgreSQL (PLpgSQL)
  '.mysql': 'sql',
  '.hqsql': 'sql', // Hive Query Language (non-standard alias)
  '.hql': 'sql', // HiveQL
  '.q': 'sql', // HiveQL query files

  // PLSQL – Oracle PL/SQL
  '.pls': 'sql',
  '.bdy': 'sql', // Package body
  '.fnc': 'sql', // Function
  '.pck': 'sql', // Package
  '.pkb': 'sql', // Package body
  '.pks': 'sql', // Package specification
  '.plb': 'sql', // Library
  '.plsql': 'sql',
  '.prc': 'sql', // Procedure
  '.spc': 'sql', // Specification
  '.tpb': 'sql', // Trigger body
  '.tps': 'sql', // Trigger spec
  '.trg': 'sql', // Trigger
  '.vw': 'sql', // View

  // SQLPL – DB2 SQL Procedural Language
  '.db2': 'sql', // IBM DB2 SQL
  '.cql': 'sql', // Cassandra Query Language
  '.tab': 'sql', // Table definitions
  '.udf': 'sql', // User-defined function
  '.viw': 'sql', // View

  // Extended dialects – for full support
  '.sqlite': 'sql',
  '.sqlite3': 'sql',
  '.bq': 'sql', // BigQuery shorthand
  '.bigquery': 'sql',
  '.sf.sql': 'sql', // Snowflake
  '.rs.sql': 'sql', // Redshift
  '.trino.sql': 'sql', // Trino
  '.singlestore.sql': 'sql', // SingleStoreDB (formerly MemSQL)
  '.spark.sql': 'sql', // Spark SQL
  '.n1ql': 'sql', // Couchbase N1QL
  '.mariadb.sql': 'sql',
  '.db2i': 'sql', // IBM DB2i (experimental)
  '.flink.sql': 'sql', // FlinkSQL
  '.flinksql': 'sql', // FlinkSQL

  // TOML
  '.toml': 'toml',

  // Twig
  '.twig': 'twig',
  '.html.twig': 'twig',

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

  // Vue Single-File Components
  '.vue': 'vue',
}

// Pre-sorted by length (descending), so longest match wins first —
// prevents false positives like ".php" matching ".blade.php" files.
const sortedExtensions = Object.keys(extToSyntax).sort(
  (a, b) => b.length - a.length,
)

// SQL-dialect-specific syntaxes Nova reports (only with the SQL Language
// Extension installed) — normalize them to "sql"
const sqlAliases = new Set([
  'bigquery',
  'flinksql',
  'hiveql',
  'mariadb',
  'mysql',
  'plsql',
  'postgresql',
  'redshift',
  'singlestore',
  'snowflake',
  'sparksql',
  'sql-generic',
  'sqlite',
  'sqlpl',
  'trino',
  'tsql',
])

// Basename matchers for prettier-plugin-sh languages that can't be
// expressed as path suffixes: bare filenames (hosts, CODEOWNERS,
// gradlew, …), dotless rc twins (bashrc, profile, …), dotenv prefixes
// (.env.local, .env.production, …), and the .husky hook directory.
// Mirrors the plugin's own `isSupported` matchers.
const basenameExact = new Set([
  // Ignore-list twins and odd spellings
  'gitignore-global',
  'gitignore_global',
  '.atomignore',
  '.babelignore',
  '.bzrignore',
  '.coffeelintignore',
  '.cvsignore',
  '.easignore',
  '.eleventyignore',
  '.eslint-ignore',
  '.markdownlintignore',
  '.nodemonignore',
  '.stylelintignore',
  '.vercelignore',
  '.vscodeignore',

  // Option lists
  '.ackrc',
  'ackrc',
  '.rspec',
  '.yardopts',
  'mocha.opts',

  // Shell scripts without extension, incl. dotless rc twins
  '9fs',
  'pkgbuild',
  'apkbuild',
  'gradlew',
  'mvnw',
  'man',
  'bashrc',
  'bash_aliases',
  'bash_functions',
  'bash_history',
  'bash_logout',
  'bash_profile',
  'cshrc',
  'kshrc',
  'login',
  'profile',
  'tmux.conf',
  'xinitrc',
  'xsession',
  'zlogin',
  'zlogout',
  'zprofile',
  'zshenv',
  'zshrc',
  '.cshrc',
  '.flaskenv',
  '.kshrc',
  '.login',
  '.tmux.conf',
  '.xinitrc',
  '.xsession',
  '.zlogin',
  '.zlogout',
  '.bash_functions',
  '.bash_history',
  '.bash_logout',
  '.tm_properties',

  // Other languages the plugin parses as shell
  'codeowners',
  'hosts',
  'jvm.options',
])

const dotenvPrefix = '.env.'
const huskyDirSuffix = '/.husky'

/**
 * Look up a basename-based syntax key for a path.
 *
 * @param {string} path  lower-cased document path
 * @returns {string|null}
 */
function detectBasenameSyntax(path) {
  const lastSlash = path.lastIndexOf('/')
  const basename = lastSlash === -1 ? path : path.slice(lastSlash + 1)

  if (basename.startsWith(dotenvPrefix) || basename === '.env') return 'sh'
  if (basenameExact.has(basename)) return 'sh'

  // any file inside a .husky directory
  const dirname = lastSlash === -1 ? '' : path.slice(0, lastSlash)
  if (dirname.endsWith(huskyDirSuffix)) return 'sh'

  return null
}

/**
 * Determine the true syntax key for a document.
 *
 * @param {object} opts
 * @param {string} opts.syntax  the value of editor.document.syntax
 * @param {string} opts.uri     the value of editor.document.uri
 * @returns {string}            one of your internal syntax keys
 */
function detectSyntax({ syntax, uri }) {
  const advancedDetection = getConfigWithWorkspaceOverride(
    'prettier.syntax.advancedDetection',
  )

  // disabled — trust Nova entirely
  if (!advancedDetection) {
    return syntax
  }

  // Astro, Liquid, TOML and Twig: if Nova got it right, trust it
  if (
    syntax === 'astro' ||
    syntax === 'liquid-md' ||
    syntax === 'liquid-html' ||
    syntax === 'toml' ||
    syntax === 'twig'
  ) {
    return syntax
  }
  // SQL dialects: normalize to "sql"
  if (sqlAliases.has(syntax)) {
    return 'sql'
  }

  // Nova reports "shell"; normalize to our "sh" key so
  // PLUGIN_DESCRIPTORS can resolve the bundled shell plugin
  if (syntax === 'shell') {
    return 'sh'
  }

  // Extension-based detection (longest suffix first)
  const path = extractPath(uri).toLowerCase()
  for (const ext of sortedExtensions) {
    if (path.endsWith(ext)) {
      return extToSyntax[ext]
    }
  }

  // Basename-based detection for bare filenames, rc twins, dotenv
  // prefixes and .husky hooks
  const basenameSyntax = detectBasenameSyntax(path)
  if (basenameSyntax) {
    return basenameSyntax
  }

  // Nova's syntax matches one we support — use it
  return syntax
}

module.exports = { detectSyntax }
