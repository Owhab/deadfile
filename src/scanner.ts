import fg from 'fast-glob';
import path from 'path';
import type { CodePruneConfig } from './config.js';

export async function scanFiles(config: CodePruneConfig, cwd: string = process.cwd()): Promise<string[]> {
  const extList = config.extensions.map((ext: string) => ext.startsWith('.') ? ext.slice(1) : ext).join(',');
  const extPattern = extList.includes(',') ? `{${extList}}` : extList;

  const ignorePatterns = [
    ...config.exclude.map((ex: string) => `**/${ex}/**`),
    ...config.exclude.map((ex: string) => `**/${ex}`),
    ...config.ignore.map((ig: string) => `**/${ig}/**`),
    '**/node_modules/**',
    '**/.git/**',
  ];

  const globPatterns = config.include.length > 0
    ? config.include.map((dir: string) => `${dir}/**/*.${extPattern}`)
    : [`**/*.${extPattern}`];

  const files = await fg(globPatterns, {
    cwd,
    ignore: ignorePatterns,
    absolute: true,
    dot: false,
  });

  return files.map(file => path.normalize(file));
}
