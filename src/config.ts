import fs from "fs";
import path from "path";

export interface CodePruneConfig {
  include: string[];
  exclude: string[];
  extensions: string[];
  entry: string[];
  ignore: string[];
}

const DEFAULT_CONFIG: CodePruneConfig = {
  include: [
    "src",
    "app",
    "pages",
    "lib",
    "utils",
    "components",
    "routes",
    "screens",
  ],
  exclude: [
    "node_modules",
    ".next",
    "dist",
    "build",
    ".git",
    "coverage",
    ".cache",
    "babel.config.js",
    "babel.config.cjs",
    "babel.config.mjs",
    "eslint.config.js",
    "eslint.config.cjs",
    "eslint.config.mjs",
    ".eslintrc*",
    "tailwind.config.js",
    "tailwind.config.ts",
    "tailwind.config.mjs",
    "metro.config.js",
    "prettier.config.js",
    ".prettierrc*",
    "jest.config.js",
    "jest.config.ts",
    "vitest.config.ts",
    "tsconfig.json",
    "jsconfig.json",
    ".npm",
    ".expo",
  ],
  extensions: [".js", ".ts", ".tsx", ".jsx", ".mjs", ".cjs"],
  entry: [
    "index.js",
    "index.ts",
    "index.tsx",
    "App.tsx",
    "App.js",
    "App.ts",
    "src/index.js",
    "src/index.ts",
    "src/index.tsx",
    "src/main.js",
    "src/main.ts",
    "src/main.tsx",
    "src/app",
    "app",
    "src/pages",
    "pages",
  ],
  ignore: [],
};

function ensureStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value === "string") {
    return [value];
  }
  return [];
}

export function loadConfig(customPath?: string): CodePruneConfig {
  const configPath = customPath
    ? path.resolve(process.cwd(), customPath)
    : path.resolve(process.cwd(), "codeprune.config.json");

  if (fs.existsSync(configPath)) {
    try {
      const fileContent = fs.readFileSync(configPath, "utf-8");
      const parsed = JSON.parse(fileContent);

      const parsedInclude = ensureStringArray(parsed.include);
      const parsedExclude = ensureStringArray(parsed.exclude);
      const parsedExtensions = ensureStringArray(parsed.extensions);
      const parsedEntry = ensureStringArray(parsed.entry);
      const parsedIgnore = ensureStringArray(parsed.ignore);

      return {
        include:
          parsedInclude.length > 0 ? parsedInclude : DEFAULT_CONFIG.include,
        exclude: [...DEFAULT_CONFIG.exclude, ...parsedExclude],
        extensions:
          parsedExtensions.length > 0
            ? parsedExtensions
            : DEFAULT_CONFIG.extensions,
        entry: parsedEntry.length > 0 ? parsedEntry : DEFAULT_CONFIG.entry,
        ignore: [...DEFAULT_CONFIG.ignore, ...parsedIgnore],
      };
    } catch (error: any) {
      console.error(
        `Error parsing config file at ${configPath}:`,
        error.message,
      );
    }
  }

  return DEFAULT_CONFIG;
}
