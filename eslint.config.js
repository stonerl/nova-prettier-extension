const { defineConfig } = require('eslint/config')

module.exports = defineConfig({
  // 1. where to look for files (default is “**/*.js”):
  files: ['**/*.js'],

  // 2. environment globals
  languageOptions: {
    ecmaVersion: 2021,
    sourceType: 'module',
    globals: {
      browser: 'readonly',
      node: 'readonly',
    },
  },

  // 3. enable recommended rules
  plugins: {},
  settings: {},

  rules: {
    // stylistic
    indent: ['error', 2, { SwitchCase: 1, offsetTernaryExpressions: true }],
    quotes: [
      'error',
      'single',
      {
        avoidEscape: true,
        allowTemplateLiterals: true,
      },
    ],

    // best practices
    'no-unused-vars': ['warn'],
    'no-console': ['off'],

    // modern JS
    'prefer-const': ['error'],
    'no-var': ['error'],
  },
})
