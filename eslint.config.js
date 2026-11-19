import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/** Shared lint rules (plan section 20). Boundary rules protect the AI data policy and configuration access. */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/next-env.d.ts',
      '**/coverage/**',
      'CIRCULAR2ACTION_*.md',
      'scripts/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.mjs', '**/next.config.*'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly', URL: 'readonly' } },
  },
  {
    // the browser service worker runs in its own global scope
    files: ['apps/web/public/sw.js'],
    languageOptions: {
      globals: { self: 'readonly', URL: 'readonly' },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'off', // pure-logic packages index known-length tables; reviewed per PR
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['error', { allow: ['error', 'warn'] }],
    },
  },
  {
    // AIP-05: provider SDKs may only be imported by the gateway providers.
    files: ['apps/**/*.ts', 'packages/**/*.ts'],
    ignores: ['apps/api/src/modules/ai/providers/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@google/genai', '@google/generative-ai', '@google-cloud/*'],
              message: 'Call AI only through AiGateway (plan AIP-05).',
            },
          ],
        },
      ],
    },
  },
  {
    // SEC-33: configuration is read in one place only.
    files: ['apps/api/src/**/*.ts'],
    ignores: ['apps/api/src/platform/config.ts', 'apps/api/src/server.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message: 'Read configuration through platform/config.ts (plan SEC-33).',
        },
      ],
    },
  },
  {
    // business code must use the Clock interface (plan section 19.9)
    files: ['apps/api/src/modules/**/*.ts', 'packages/eligibility/src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: 'Use the injected Clock instead of Date.now() in business code.',
        },
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'Use the injected Clock instead of new Date() in business code.',
        },
      ],
    },
  },
);
