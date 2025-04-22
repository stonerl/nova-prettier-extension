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

const { getConfigWithWorkspaceOverride } = require('./helpers.js')

// 1) Map file‑name suffixes (longest first) to your internal language keys
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
  '.html.erb': 'html+erb',
  '.ejs': 'html+ejs',
  '.erb': 'html+erb',
  '.html': 'html',
  '.htm': 'html',

  // JS / TS ecosystem
  '.tsx': 'tsx',
  '.cts': 'typescript',
  '.mts': 'typescript',
  '.ts': 'typescript',
  '.jsx': 'jsx',
  '.cjs': 'javascript',
  '.mjs': 'javascript',
  '.js': 'javascript',

  // Flow (optional suffix cases)
  '.flow.js': 'flow',
  '.flow.jsx': 'flow',

  // GraphQL
  '.graphql': 'graphql',
  '.gql': 'graphql',

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

  // SQL / XML / Nginx
  '.sql': 'sql',
  '.xml': 'xml',
  '.xsd': 'xml',
  '.xsl': 'xml',
  '.rss': 'xml',
  '.conf': 'nginx',
  '.nginx': 'nginx',
  '.nginxconf': 'nginx',

  // Markdown
  '.markdown': 'markdown',
  '.md': 'markdown',

  // Vue Single‑File Components
  '.vue': 'vue',
}

// 2) Nova’s built‑in syntax keys we explicitly support
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
 * Extract a filesystem‑style path from any Nova Document URI.
 * Supports file://, sftp://, ssh://, etc.; falls back to raw URI if parsing fails.
 */
function extractPath(uri) {
  try {
    return new URL(uri).pathname
  } catch {
    return uri
  }
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
  for (const ext of Object.keys(extToSyntax).sort(
    (a, b) => b.length - a.length,
  )) {
    if (path.endsWith(ext)) {
      return extToSyntax[ext]
    }
  }

  // 2) If Nova’s syntax matches one you support, use that
  if (knownSyntaxKeys.has(syntax)) {
    return syntax
  }

  // 3) Otherwise give Nova’s value back
  return syntax
}

module.exports = { detectSyntax }
