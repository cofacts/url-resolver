module.exports = {
  parser: 'babel-eslint',
  parserOptions: { ecmaVersion: 2020 },
  extends: ['eslint:recommended', 'plugin:node/recommended', 'prettier'],
  env: {
    node: true,
    es6: true,
    jest: true,
    es2020: true,
  },
  plugins: ['prettier'],
  rules: {
    'prettier/prettier': [
      'error',
      {
        trailingComma: 'es5',
        singleQuote: true,
      },
    ],
    'node/no-unpublished-require': [
      'error',
      {
        allowModules: ['puppeteer'],
      },
    ],
  },
};
