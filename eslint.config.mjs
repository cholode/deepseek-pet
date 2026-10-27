import js from '@eslint/js';
import ts from 'typescript-eslint';
export default ts.config({ ignores: ['node_modules/**', 'out/**', 'release/**', 'test-results/**', 'desktop-pet-codex-kit/**', 'scripts/*.cjs', 'art/**', 'src/renderer/public/**'] }, js.configs.recommended, ...ts.configs.recommended, { files: ['plugins/**/*.mjs'], languageOptions: { globals: { fetch: 'readonly', AbortSignal: 'readonly', AbortController: 'readonly' } } }, { rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }] } });
