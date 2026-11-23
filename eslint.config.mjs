// One flat config for the monorepo; type-aware rules use each package's tsconfig.json.
import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import prettierConfig from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: ['**/node_modules/', '**/dist/', '**/.next/', '**/coverage/', '**/next-env.d.ts'],
  },

  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      eqeqeq: ['error', 'always'],
      'no-console': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // Plain JS config files belong to no tsconfig.
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  // Next.js + React rules for the web app only.
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    extends: [nextPlugin.configs['core-web-vitals'], reactHooks.configs.flat.recommended],
    languageOptions: { globals: globals.browser },
    settings: { next: { rootDir: 'apps/web' } },
    rules: {
      // Prefetching a per-request page runs its generateMetadata, an API request /admin counts
      // though nobody clicked (DESIGN.md §8.6), so each link must choose.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "JSXOpeningElement[name.name='Link']:not(:has(JSXAttribute[name.name='prefetch']))",
          message:
            'Give this <Link> a prefetch prop: prefetch={false} for a page whose title asks the API (DESIGN.md §8.6).',
        },
      ],
    },
  },

  // Last: turns off stylistic rules Prettier owns.
  prettierConfig,
);
