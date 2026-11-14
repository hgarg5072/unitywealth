import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';
import ts from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
  {
    ignores: ['dist/**/*', 'node_modules/**/*']
  },
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    plugins: {
      '@typescript-eslint': ts,
    },
    rules: {
      // TS rules
    }
  },
  {
    files: ['*.rules'],
    plugins: {
      '@firebase/security-rules': firebaseRulesPlugin
    },
    rules: {
      ...firebaseRulesPlugin.configs['flat/recommended'].rules
    }
  }
]
