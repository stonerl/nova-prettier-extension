// eslint.config.js
const { defineConfig } = require('eslint/config')
const prettierFlat = require('eslint-config-prettier/flat')

module.exports = defineConfig([
  {
    ignores: ['tests/**'],
  },

  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'module',
      globals: {
        browser: 'readonly',
        node: 'readonly',
      },
    },

    rules: {
      'no-unused-vars': [
        'warn',
        {
          args: 'after-used',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      'no-console': 'off',
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },

  prettierFlat,
])
