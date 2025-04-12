// plugins.js
module.exports = {
  xml: nova.path.join(
    nova.extension.path,
    'node_modules',
    '@prettier',
    'plugin-xml',
    'src',
    'plugin.js',
  ),
  php: nova.path.join(
    nova.extension.path,
    'node_modules',
    '@prettier',
    'plugin-php',
    'src',
    'index.mjs',
  ),
  sql: nova.path.join(
    nova.extension.path,
    'node_modules',
    'prettier-plugin-sql',
    'lib',
    'index.cjs',
  ),
  nginx: nova.path.join(
    nova.extension.path,
    'node_modules',
    'prettier-plugin-nginx',
    'dist',
    'index.js',
  ),
  java: nova.path.join(
    nova.extension.path,
    'node_modules',
    'prettier-plugin-java',
    'dist',
    'index.js',
  ),
  properties: nova.path.join(
    nova.extension.path,
    'node_modules',
    'prettier-plugin-properties',
    'index.js',
  ),
}
