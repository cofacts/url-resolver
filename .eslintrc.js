module.exports = {
  parserOptions: { ecmaVersion: 2018 },
  extends: [
    'eslint:recommended',
    'plugin:node/recommended',
    'prettier',
  ],
  env: {
    node: true, es6: true, jest: true
  },
  plugins: [
    'prettier',
  ],
  rules: {
    'prettier/prettier': ['error', {
      trailingComma: 'es5',
      singleQuote: true,
    }],
    'node/no-unpublished-require': ['error', {
      allowModules: ['puppeteer']
    }],
  },
}
