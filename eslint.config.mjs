import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";
import youMightNotNeedAnEffect from "eslint-plugin-react-you-might-not-need-an-effect";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    plugins: {
      "react-you-might-not-need-an-effect": youMightNotNeedAnEffect,
    },
    rules: {
      "react-you-might-not-need-an-effect/no-empty-effect": "warn",
      "react-you-might-not-need-an-effect/no-adjust-state-on-prop-change": "warn",
      "react-you-might-not-need-an-effect/no-event-handler": "warn",
      "react-you-might-not-need-an-effect/no-initialize-state": "warn",
      "react-you-might-not-need-an-effect/no-chain-state-updates": "warn",
    },
  },
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
    ],
  },
];

export default eslintConfig;
