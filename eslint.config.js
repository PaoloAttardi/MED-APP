import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // android/app/build holds cap sync's copy of the bundle: generated, and it
  // trips react-refresh/no-duplicate-imports on minified output.
  globalIgnores(['dist', 'android/app/build', 'android/app/src/main/assets/public']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // Leading underscore is the codebase's "intentionally unused" marker.
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
      // Context providers legitimately co-export their hook; splitting them into
      // separate files would only serve the dev-only HMR boundary.
      'react-refresh/only-export-components': ['error', { allowConstantExport: true }],
      // Every hit here is "hydrate state from IndexedDB/getSettings on mount".
      // That is the right shape for an offline app with no data layer, so it
      // stays visible as a warning rather than triggering a refactor.
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
  {
    files: ['**/ToastContext.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
])
