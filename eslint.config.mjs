import js from '@eslint/js';
import ts from 'typescript-eslint';
export default ts.config(
  { ignores: ['dist/**', 'node_modules/**', 'examples/**', 'fixtures/**', 'docs/**'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  { languageOptions: { globals: { process: 'readonly', console: 'readonly', Buffer: 'readonly', URL: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly' } }, rules: { '@typescript-eslint/no-explicit-any': 'off' } },
  { files: ['packages/web/assets/*.js', 'website/public/*.js'], languageOptions: { globals: { document: 'readonly', fetch: 'readonly', Blob: 'readonly', navigator: 'readonly', history: 'readonly', location: 'readonly', URLSearchParams: 'readonly', AbortController: 'readonly', TextEncoder: 'readonly', TextDecoder: 'readonly', window: 'readonly', IntersectionObserver: 'readonly' } } },
);
