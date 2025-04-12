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
} = require('./prettier-options.js')

function getDefaultConfig() {
  return Object.fromEntries(
    PRETTIER_OPTIONS.map((option) => [
      option,
      getConfigWithWorkspaceOverride(`prettier.default-config.${option}`),
    ]),
  )
}

function getPhpConfig() {
  return Object.fromEntries(
    PRETTIER_PHP_PLUGIN_OPTIONS.map((option) => [
      option,
      getConfigWithWorkspaceOverride(
        `prettier.plugins.prettier-plugin-php.${option}`,
      ),
    ]),
  )
}

function getXmlConfig() {
  return Object.fromEntries(
    PRETTIER_XML_PLUGIN_OPTIONS.map((option) => [
      option,
      getConfigWithWorkspaceOverride(
        `prettier.plugins.prettier-plugin-xml.${option}`,
      ),
    ]),
  )
}

function getSqlFormatterConfig() {
  return Object.fromEntries(
    PRETTIER_SQL_PLUGIN_SQL_FORMATTER_OPTIONS.map((option) => [
      option,
      getConfigWithWorkspaceOverride(
        `prettier.plugins.prettier-plugin-sql.sql-formatter.${option}`,
      ),
    ]),
  )
}

function getNodeSqlParserConfig() {
  return Object.fromEntries(
    PRETTIER_SQL_PLUGIN_NODE_SQL_PARSER_OPTIONS.map((option) => [
      option,
      getConfigWithWorkspaceOverride(
        `prettier.plugins.prettier-plugin-sql.node-sql-parser.${option}`,
      ),
    ]),
  )
}

function getPropertiesConfig() {
  return Object.fromEntries(
    PRETTIER_PROPERTIES_PLUGIN_OPTIONS.map((option) => [
      option,
      getConfigWithWorkspaceOverride(
        `prettier.plugins.prettier-plugin-properties.${option}`,
      ),
    ]),
  )
}

function getNginxConfig() {
  return Object.fromEntries(
    PRETTIER_NGINX_PLUGIN_OPTIONS.map((option) => [
      option,
      getConfigWithWorkspaceOverride(
        `prettier.plugins.prettier-plugin-nginx.${option}`,
      ),
    ]),
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
}
