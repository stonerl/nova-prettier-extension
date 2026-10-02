/**
 * plugin-registry.js — Bundled plugin registry for Prettier⁺ for Nova
 *
 * @license MIT
 * @author Toni Förster
 * @copyright © 2026 Toni Förster
 *
 * Single source of truth for the bundled Prettier plugins: their
 * entry-point paths for runtime injection, their config keys under
 * `prettier.plugins.*`, and — for plugins with Nova-managed options —
 * the loaders producing them.
 */

const { getConfigWithWorkspaceOverride, log } = require('./helpers.js')

const {
  getAstroConfig,
  getBladeConfig,
  getLiquidConfig,
  getNginxConfig,
  getPhpConfig,
  getPropertiesConfig,
  getShConfig,
  getTailwindConfig,
  getTomlConfig,
  getTwigConfig,
  getXmlConfig,
} = require('./prettier-config.js')

const pluginPaths = {
  astro: nova.path.join(
    nova.extension.path,
    'node_modules',
    'prettier-plugin-astro',
    'dist',
    'index.js',
  ),
  blade: nova.path.join(
    nova.extension.path,
    'node_modules',
    '@shufo',
    'prettier-plugin-blade',
    'dist',
    'index.cjs',
  ),
  ejs: nova.path.join(
    nova.extension.path,
    'node_modules',
    'prettier-plugin-ejs',
    'index.js',
  ),
  java: nova.path.join(
    nova.extension.path,
    'node_modules',
    'prettier-plugin-java',
    'dist',
    'index.cjs',
  ),
  liquid: nova.path.join(
    nova.extension.path,
    'node_modules',
    '@shopify',
    'prettier-plugin-liquid',
    'dist',
    'index.js',
  ),
  nginx: nova.path.join(
    nova.extension.path,
    'node_modules',
    'prettier-plugin-nginx',
    'dist',
    'cjs',
    'index.js',
  ),
  php: nova.path.join(
    nova.extension.path,
    'node_modules',
    '@prettier',
    'plugin-php',
    'src',
    'index.mjs',
  ),
  properties: nova.path.join(
    nova.extension.path,
    'node_modules',
    'prettier-plugin-properties',
    'index.js',
  ),
  sh: nova.path.join(
    nova.extension.path,
    'node_modules',
    'prettier-plugin-sh',
    'lib',
    'index.cjs',
  ),
  sql: nova.path.join(
    nova.extension.path,
    'node_modules',
    'prettier-plugin-sql',
    'lib',
    'index.js',
  ),
  tailwind: nova.path.join(
    nova.extension.path,
    'node_modules',
    'prettier-plugin-tailwindcss',
    'dist',
    'index.mjs',
  ),
  toml: nova.path.join(
    nova.extension.path,
    'node_modules',
    'prettier-plugin-toml',
    'lib',
    'index.js',
  ),
  twig: nova.path.join(
    nova.extension.path,
    'node_modules',
    '@zackad',
    'prettier-plugin-twig',
    'src',
    'index.js',
  ),
  xml: nova.path.join(
    nova.extension.path,
    'node_modules',
    '@prettier',
    'plugin-xml',
    'src',
    'plugin.js',
  ),
}

/**
 * Flag-only plugins (ejs, tailwind) never act as the primary parser for
 * a syntax; they are selected by the ordering rules in format-request.js.
 */
const PLUGIN_DESCRIPTORS = {
  astro: {
    configKey: 'prettier-plugin-astro',
    pluginPath: pluginPaths.astro,
    optionsConfig: getAstroConfig,
  },
  blade: {
    configKey: 'prettier-plugin-blade',
    pluginPath: pluginPaths.blade,
    optionsConfig: getBladeConfig,
  },
  ejs: {
    configKey: 'prettier-plugin-ejs',
    pluginPath: pluginPaths.ejs,
    optionsConfig: null,
  },
  java: {
    configKey: 'prettier-plugin-java',
    pluginPath: pluginPaths.java,
    optionsConfig: null,
  },
  'java-properties': {
    configKey: 'prettier-plugin-properties',
    pluginPath: pluginPaths.properties,
    optionsConfig: getPropertiesConfig,
  },
  'liquid-html': {
    configKey: 'prettier-plugin-liquid',
    pluginPath: pluginPaths.liquid,
    optionsConfig: getLiquidConfig,
  },
  'liquid-md': {
    configKey: 'prettier-plugin-liquid',
    pluginPath: pluginPaths.liquid,
    optionsConfig: getLiquidConfig,
  },
  nginx: {
    configKey: 'prettier-plugin-nginx',
    pluginPath: pluginPaths.nginx,
    optionsConfig: getNginxConfig,
  },
  php: {
    configKey: 'prettier-plugin-php',
    pluginPath: pluginPaths.php,
    optionsConfig: getPhpConfig,
  },
  sh: {
    configKey: 'prettier-plugin-sh',
    pluginPath: pluginPaths.sh,
    optionsConfig: getShConfig,
  },
  dockerfile: {
    configKey: 'prettier-plugin-sh',
    pluginPath: pluginPaths.sh,
    optionsConfig: getShConfig,
  },
  sql: {
    configKey: 'prettier-plugin-sql',
    pluginPath: pluginPaths.sql,
    // SQL formatter config is handled separately — depends on the
    // configured formatter type
    optionsConfig: null,
  },
  tailwind: {
    configKey: 'prettier-plugin-tailwind',
    pluginPath: pluginPaths.tailwind,
    optionsConfig: getTailwindConfig,
  },
  toml: {
    configKey: 'prettier-plugin-toml',
    pluginPath: pluginPaths.toml,
    optionsConfig: getTomlConfig,
  },
  twig: {
    configKey: 'prettier-plugin-twig',
    pluginPath: pluginPaths.twig,
    optionsConfig: getTwigConfig,
  },
  xml: {
    configKey: 'prettier-plugin-xml',
    pluginPath: pluginPaths.xml,
    optionsConfig: getXmlConfig,
  },
}

/**
 * Read a plugin's enabled flag from workspace-or-extension config.
 *
 * @param {string} configKey  the plugin's key under `prettier.plugins.*`
 * @returns {boolean|undefined}
 */
function isPluginEnabled(configKey) {
  return getConfigWithWorkspaceOverride(`prettier.plugins.${configKey}.enabled`)
}

/**
 * Bundled plugins whose registry entry file is missing from the
 * installed bundle — usually a plugin update that reshuffled its file
 * layout while plugin-registry.js still points at the old path.
 *
 * @returns {{ key: string, path: string }[]}
 */
function findMissingBundledPlugins() {
  return Object.entries(pluginPaths)
    .filter(([, pluginPath]) => !nova.fs.stat(pluginPath))
    .map(([key, pluginPath]) => ({ key, path: pluginPath }))
}

// Paths already reported this session, keyed by report level — service
// restarts must not re-spam the console, and a mode switch (native →
// bundled) must still escalate the report to a warning.
const warnedMissingPluginPaths = new Set()

/**
 * Report bundled plugins whose registry entry file is missing. In
 * bundled mode a missing entry file fails that plugin's syntaxes at
 * format time with no visible cause, so surface it as a warning; in
 * native modes the files are never imported, so stay quiet at debug
 * level.
 *
 * @param {boolean} bundledMode – whether the running Prettier module is
 *   the extension bundle
 */
function reportMissingBundledPlugins(bundledMode) {
  for (const { key, path } of findMissingBundledPlugins()) {
    const dedupeKey = `${bundledMode ? 'warn' : 'debug'}:${path}`
    if (warnedMissingPluginPaths.has(dedupeKey)) continue
    warnedMissingPluginPaths.add(dedupeKey)
    if (bundledMode) {
      log.warn(
        `Bundled plugin "${key}" is missing its entry file — check plugin-registry.js against the installed package: ${path}`,
      )
    } else {
      log.debug(
        `Bundled plugin "${key}" is not installed (bundled modules not populated): ${path}`,
      )
    }
  }
}

module.exports = {
  PLUGIN_DESCRIPTORS,
  findMissingBundledPlugins,
  isPluginEnabled,
  pluginPaths,
  reportMissingBundledPlugins,
}
