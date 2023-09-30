/* eslint-env node */
module.exports = {
  root: true,
  extends: "eslint:recommended",
  env: {
    browser: true,
    greasemonkey: true,
    es2020: true,
  },
  overrides: [
    {
      extends: "plugin:userscripts/recommended",
      files: [
        '*.user.js',
      ],
    },
  ],
};
