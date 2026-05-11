import fg from 'fast-glob';
import path from 'path';
import type { CodePruneConfig } from './config.js';

export async function scanFiles(config: CodePruneConfig, cwd: string = process.cwd()): Promise<string[]> {
  const extList = config.extensions.map((ext: string) => ext.startsWith('.') ? ext.slice(1) : ext).join(',');
  const extPattern = extList.includes(',') ? `{${extList}}` : extList;

  const ignorePatterns = [
    ...config.exclude.map((ex: string) => `**/${ex}/**`),
    ...config.ignore.map((ig: string) => `**/${ig}/**`)
  ];

  const files = await fg(`**/*.${extPattern}`, {
    cwd,
    ignore: ignorePatterns,
    absolute: true,
    dot: true,
  });

  return files.map(file => path.normalize(file));
}
