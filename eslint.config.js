import js from '@eslint/js';
export default [
  { ignores: ['node_modules/**'] },
  js.configs.recommended,
  { files: ['**/*.js'], languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: {
    process: 'readonly', console: 'readonly', Buffer: 'readonly', URL: 'readonly', TextDecoder: 'readonly',
    setTimeout: 'readonly', clearTimeout: 'readonly', AbortController: 'readonly', structuredClone: 'readonly',
  } }, rules: { 'no-control-regex': 'off', 'no-empty': ['error', { allowEmptyCatch: true }], 'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }] } },
];
