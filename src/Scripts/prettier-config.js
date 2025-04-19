/**
 * prettier-config.js — Dynamic config loader for Prettier plugins
 *
 * @license MIT
 * @author Toni Förster
 * @copyright © 2025 Toni Förster
 *
 * Retrieves plugin-specific configuration options from Nova's settings system.
 */

const { getConfigWithWorkspaceOverride } = require('./helpers.js')
const {
  PRETTIER_OPTIONS,
  PRETTIER_PHP_PLUGIN_OPTIONS,
  PRETTIER_XML_PLUGIN_OPTIONS,
  PRETTIER_SQL_PLUGIN_SQL_FORMATTER_OPTIONS,
  PRETTIER_SQL_PLUGIN_NODE_SQL_PARSER_OPTIONS,
  PRETTIER_PROPERTIES_PLUGIN_OPTIONS,
  PRETTIER_NGINX_PLUGIN_OPTIONS,
  PRETTIER_LIQUID_PLUGIN_OPTIONS,
  PRETTIER_TAILWIND_PLUGIN_OPTIONS,
} = require('./prettier-options.js')

function loadPluginConfig(optionsList, configKeyBase) {
  return Object.fromEntries(
    optionsList
      .map((option) => [
        option,
        getConfigWithWorkspaceOverride(`${configKeyBase}.${option}`),
      ])
      .filter(([, value]) => value != null),
  )
}

function getDefaultConfig() {
  return Object.fromEntries(
    PRETTIER_OPTIONS.map((option) => [
      option,
      getConfigWithWorkspaceOverride(`prettier.default-config.${option}`),
    ]),
  )
}

function getPhpConfig() {
  return loadPluginConfig(
    PRETTIER_PHP_PLUGIN_OPTIONS,
    'prettier.plugins.prettier-plugin-php',
  )
}

function getXmlConfig() {
  return loadPluginConfig(
    PRETTIER_XML_PLUGIN_OPTIONS,
    'prettier.plugins.prettier-plugin-xml',
  )
}

function getSqlFormatterConfig() {
  return loadPluginConfig(
    PRETTIER_SQL_PLUGIN_SQL_FORMATTER_OPTIONS,
    'prettier.plugins.prettier-plugin-sql.sql-formatter',
  )
}

function getNodeSqlParserConfig() {
  return loadPluginConfig(
    PRETTIER_SQL_PLUGIN_NODE_SQL_PARSER_OPTIONS,
    'prettier.plugins.prettier-plugin-sql.node-sql-parser',
  )
}

function getPropertiesConfig() {
  return loadPluginConfig(
    PRETTIER_PROPERTIES_PLUGIN_OPTIONS,
    'prettier.plugins.prettier-plugin-properties',
  )
}

function getNginxConfig() {
  return loadPluginConfig(
    PRETTIER_NGINX_PLUGIN_OPTIONS,
    'prettier.plugins.prettier-plugin-nginx',
  )
}

function getLiquidConfig() {
  return loadPluginConfig(
    PRETTIER_LIQUID_PLUGIN_OPTIONS,
    'prettier.plugins.prettier-plugin-liquid',
  )
}

function getTailwindConfig() {
  return loadPluginConfig(
    PRETTIER_TAILWIND_PLUGIN_OPTIONS,
    'prettier.plugins.prettier-plugin-tailwind',
  )
}

module.exports = {
  getDefaultConfig,
  getPhpConfig,
  getXmlConfig,
  getSqlFormatterConfig,
  getNodeSqlParserConfig,
  getPropertiesConfig,
  getNginxConfig,
  getLiquidConfig,
  getTailwindConfig,
}
