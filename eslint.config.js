import eslint from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import formatjs from "eslint-plugin-formatjs";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

const literalJsx = formatjs.rules["no-literal-string-in-jsx"];
const fixedText = /^(?:合谱(?: · Same Page)?|Same Page|Cloudflare|PDF|MusicXML|MIDI|MP3|WAV|XML|URL|QR|GB|MB|KB|BPM|Hz|https?:\/\/)$/i;
const productCopy = {
  meta: literalJsx.meta,
  create(context) {
    return literalJsx.create(Object.create(context, { report: { value(report) {
      const node = report.node.type === "JSXAttribute" ? report.node.value : report.node;
      const text = (node.type === "TemplateLiteral" ? node.quasis.map(part => part.value.raw).join("") : node.value).trim();
      if (/\p{L}/u.test(text) && !fixedText.test(text)) context.report(report);
    } } }));
  },
};

export default defineConfig([
  globalIgnores(["**/dist", "artifacts", "coverage", "worker-configuration.d.ts", "android/generated", "android/node_modules", "android/out", "vendor/alphatab/modified-source"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [eslint.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      ...reactRefresh.configs.vite.rules,
    },
  },
  {
    files: ["src/client/**/*.tsx"],
    ignores: ["**/*.test.tsx", "src/client/admin/**"],
    plugins: { i18n: { rules: { "product-copy": productCopy } } },
    rules: {
      "i18n/product-copy": ["error", { props: { include: [["*", "{label,placeholder,title,textValue}"]] } }],
    },
  },
]);
