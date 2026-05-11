import fs from 'fs';
import path from 'path';

export interface CodePruneConfig {
  exclude: string[];
  extensions: string[];
  entry: string[];
  ignore: string[];
}

const DEFAULT_CONFIG: CodePruneConfig = {
  exclude: [
    'node_modules', '.next', 'dist', 'build', '.git', 'coverage', '.cache',
    'babel.config.js', 'babel.config.cjs', 'babel.config.mjs',
    'eslint.config.js', 'eslint.config.cjs', 'eslint.config.mjs', '.eslintrc*',
    'tailwind.config.js', 'tailwind.config.ts', 'tailwind.config.mjs',
    'metro.config.js', 'prettier.config.js', '.prettierrc*',
    'jest.config.js', 'jest.config.ts', 'vitest.config.ts',
    'tsconfig.json', 'jsconfig.json', '.npm', '.expo'
  ],
  extensions: ['.js', '.ts', '.tsx', '.jsx', '.mjs', '.cjs'],
  entry: [
    'index.js', 'index.ts', 'index.tsx',
    'App.tsx', 'App.js', 'App.ts',
    'src/index.js', 'src/index.ts', 'src/index.tsx', 'src/main.js', 'src/main.ts', 'src/main.tsx',
    'src/app', 'app', 'src/pages', 'pages',
    'src/routes', 'routes', 'src/screens', 'screens',
    'src/components', 'components'
  ],
  ignore: [],
};

export function loadConfig(customPath?: string): CodePruneConfig {
  const configPath = customPath 
    ? path.resolve(process.cwd(), customPath)
    : path.resolve(process.cwd(), 'codeprune.config.json');

  if (fs.existsSync(configPath)) {
    try {
      const fileContent = fs.readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(fileContent);
      return {
        ...DEFAULT_CONFIG,
        ...parsed,
      };
    } catch (error: any) {
      console.error(`Error parsing config file at ${configPath}:`, error.message);
    }
  }

  return DEFAULT_CONFIG;
}
