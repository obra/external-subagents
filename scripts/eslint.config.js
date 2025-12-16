import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist', 'node_modules', '*.config.js', 'scripts/**/*.mjs', 'codex-subagent.js'],
  },
  ...tseslint.configs.recommended,
  {
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-misused-promises': 'off',
    },
  }
);
