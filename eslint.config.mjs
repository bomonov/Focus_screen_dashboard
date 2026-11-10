import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'

export default defineConfig(
  // design/ holds exported mockups (vendored React builds) and "Lyrics engine/" a separate
  // Python project with its own virtualenv; neither is our code. .claude/ holds Claude Code's
  // settings and other sessions' worktrees: whole copies of the project, linted in their own.
  // .agents/ holds agent skills installed from other people's repositories, not ours to lint.
  {
    ignores: [
      '**/node_modules',
      '**/dist',
      '**/dist-safari',
      '**/out',
      'design/**',
      'native/**',
      'Lyrics engine/**',
      '.claude/**',
      '.agents/**'
    ]
  },
  tseslint.configs.recommended,
  eslintPluginReact.configs.flat.recommended,
  eslintPluginReact.configs.flat['jsx-runtime'],
  {
    settings: {
      react: {
        version: 'detect'
      }
    }
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': eslintPluginReactHooks,
      'react-refresh': eslintPluginReactRefresh
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
      ...eslintPluginReactRefresh.configs.vite.rules,
      '@typescript-eslint/no-explicit-any': 'error'
    }
  },
  {
    // Plain JavaScript (build scripts) has no way to declare return types.
    files: ['**/*.{js,mjs,cjs}'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off'
    }
  },
  eslintConfigPrettier
)
