// eslint.config.js
const { defineConfig } = require('eslint/config')

module.exports = defineConfig({
  files: ['**/*.js'],

  languageOptions: {
    ecmaVersion: 2021,
    sourceType: 'module',
    globals: {
      browser: 'readonly',
      node: 'readonly',
    },
  },

  extends: ['eslint:recommended', 'prettier'],

  plugins: [],

  settings: {},

  rules: {
    // Best practices
    'no-unused-vars': [
      'warn',
      {
        args: 'after-used',
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      },
    ],
    'no-console': 'off',

    // Modern JS
    'prefer-const': 'error',
    'no-var': 'error',
  },
})
