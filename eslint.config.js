// Only the Rules of Hooks; typescript-eslint is here as the parser. vite-plugin-checker runs it in dev and build.
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default [
  // src/router.ts is generated; `**/._*` are binary macOS metadata files.
  { ignores: ['dist/**', 'node_modules/**', '.wrangler/**', '.vite/**', '.deepspace/**', 'src/router.ts', '**/._*'] },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
    },
  },
]
