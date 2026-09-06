import js from '@eslint/js';
import ts from 'typescript-eslint';
export default ts.config({ ignores: ['node_modules/**', 'out/**', 'release/**', 'desktop-pet-codex-kit/**', 'scripts/*.cjs'] }, js.configs.recommended, ...ts.configs.recommended, { rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }] } });
