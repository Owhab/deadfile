import fs from 'fs';
import path from 'path';

export interface CodePruneConfig {
  include: string[];
  exclude: string[];
  extensions: string[];
  entry: string[];
  ignore: string[];
}

const DEFAULT_CONFIG: CodePruneConfig = {
  include: ['src'],
  exclude: ['node_modules', '.next', 'dist', 'build'],
  extensions: ['.js', '.ts', '.tsx', '.jsx', '.mjs', '.cjs'],
  entry: ['src/pages', 'src/app', 'src/index.ts', 'src/index.tsx', 'src/index.js'],
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
