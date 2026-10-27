import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "dist/**",
      "next-env.d.ts",
      "tsconfig.tsbuildinfo",
    ],
  },
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // eslint-config-next 16 で追加された React Compiler 系ルール。
      // 既存の「effect 内で fetch → setState」パターンが 18 箇所該当し、
      // 動作上の不具合ではないため一旦 warn に落として段階的に直す。
      "react-hooks/set-state-in-effect": "warn",
    },
  },
];

export default config;
