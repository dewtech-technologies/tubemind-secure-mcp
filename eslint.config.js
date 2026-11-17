// ESLint 9 flat config para tubemind-secure-mcp v0.2
// Cobre src/**/*.ts — testes ficam fora (vitest tem suas próprias asserções)
import tsEslint from '@typescript-eslint/eslint-plugin'
import tsParser from '@typescript-eslint/parser'

export default [
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        AbortSignal: 'readonly',
        crypto: 'readonly',
        fetch: 'readonly',
        Response: 'readonly',
        Request: 'readonly',
        Headers: 'readonly',
        FormData: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
        globalThis: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsEslint,
    },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': 'off', // MCP loga via console.error (stderr) intencionalmente
      'no-undef': 'error',
      'prefer-const': 'warn',
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**', 'tests/**', '*.config.js', '*.config.ts'],
  },
]
