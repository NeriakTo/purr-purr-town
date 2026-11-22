import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'dist-revamp', 'dist-revamp-test', 'test-results', 'playwright-report', 'blob-report']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },
  // 後端（Node 環境）
  {
    files: ['server/**/*.js'],
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    },
  },
  // 新版網頁：建置時注入的常數
  {
    files: ['src/revamp/**/*.{js,jsx}'],
    languageOptions: {
      globals: { __APP_VERSION__: 'readonly' },
    },
  },
  // 建置設定、瀏覽器測試設定與端到端腳本（Node 環境）
  {
    files: ['config/**/*.js', 'scripts/**/*.js', 'vite.revamp.config.js', 'playwright*.config.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  // 測試檔（Node ＋ 測試常用全域，如 global）
  {
    files: ['**/*.test.{js,jsx}', 'test/**/*.{js,jsx}'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
])
