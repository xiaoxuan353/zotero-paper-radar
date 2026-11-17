// @ts-check Let TS check this config file

import zotero from "@zotero-plugin/eslint-config";

export default zotero({
  overrides: [
    {
      files: ["**/*.ts"],
      rules: {
        // We disable this rule here because the template
        // contains some unused examples and variables
        "@typescript-eslint/no-unused-vars": "off",
      },
    },
    {
      // Plain-Node helper scripts (e.g. the scaffold patch run by prebuild)
      files: ["scripts/**/*.cjs"],
      languageOptions: {
        globals: {
          process: "readonly",
          console: "readonly",
          require: "readonly",
          module: "readonly",
          __dirname: "readonly",
        },
      },
    },
  ],
});
