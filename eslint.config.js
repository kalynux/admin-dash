import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores([
    'dist',
    // ⚠ `docs/` is NOT this repository's code and must never be linted.
    //
    // It holds eight **source mirrors** — `error-codes.ts`, `article-blocks.ts`,
    // `content-domain.ts`, `content-dto.ts`, `content-validators.ts` and three of
    // jovi-mall's — each a verbatim copy of a backend file, taken so that a
    // contract can be `diff`ed rather than transcribed. `order-timeline-events.ts`
    // trips `no-explicit-any` twice, and that is the point: the `any` is in
    // jovi-mall's model and editing it out would make the copy stop being one.
    // A mirror is re-copied or it is wrong; it is never edited to please a rule
    // it was not written against.
    'docs',
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  {
    // Generated shadcn/ui output, vendored as-is from the sibling dashboard.
    // These three rules post-date the generator: the files ship helper-only
    // modules beside components, sync a media query in an effect (carousel),
    // and read a cookie during render (sidebar). Hand-editing generated output
    // to satisfy rules it was never written against would be lost on the next
    // `shadcn add`, so the directory is exempted instead — and only it.
    files: ['src/components/ui/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/purity': 'off',
    },
  },
  {
    // Test helpers are never hot-reloaded, so the fast-refresh constraint on
    // mixing components and utilities in one module does not apply.
    files: ['src/test/**/*.{ts,tsx}', 'src/**/*.{test,spec}.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
])
