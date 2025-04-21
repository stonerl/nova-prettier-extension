/**
 * prettier-plugins.js — Plugin path registry for Prettier⁺
 *
 * @license MIT
 * @author Toni Förster
 * @copyright © 2025 Toni Förster
 *
 * Maps plugin identifiers to absolute paths for runtime injection into Prettier.
 */

module.exports = {
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
  ejsTailwind: nova.path.join(
    nova.extension.path,
    'node_modules',
    'prettier-plugin-ejs-tailwindcss',
    'dist',
    'index.cjs',
  ),
  java: nova.path.join(
    nova.extension.path,
    'node_modules',
    'prettier-plugin-java',
    'dist',
    'index.js',
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
  sql: nova.path.join(
    nova.extension.path,
    'node_modules',
    'prettier-plugin-sql',
    'lib',
    'index.cjs',
  ),
  tailwind: nova.path.join(
    nova.extension.path,
    'node_modules',
    'prettier-plugin-tailwindcss',
    'dist',
    'index.mjs',
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
