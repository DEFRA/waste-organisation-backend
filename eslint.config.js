import neostandard from 'neostandard'

export default [
  ...neostandard({
    env: ['node', 'vitest'],
    ignores: [...neostandard.resolveIgnoresFromGitignore()],
    noJsx: true,
    noStyle: true
  }),
  {
    rules: {
      'max-len': ['error', { code: 160 }],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_.*', varsIgnorePattern: '^_.*' }]
    }
  }
]
