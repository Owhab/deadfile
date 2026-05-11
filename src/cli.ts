#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import path from 'path';
import readline from 'readline';
import { loadConfig } from './config.js';
import { scanFiles } from './scanner.js';
import { ImportParser } from './parser.js';
import { buildGraph, findUnusedFiles } from './graph.js';
import { ImportFixer } from './fixer.js';

interface FileItem {
  path: string;
  selected: boolean;
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function enableRawMode() {
  (process.stdin as any).setRawMode?.(true);
}

function disableRawMode() {
  (process.stdin as any).setRawMode?.(false);
}

function clearScreen() {
  console.clear();
}

function renderList(files: FileItem[], selectedIndex: number) {
  clearScreen();
  console.log(chalk.cyan('🗑️  Interactive File Deletion\n'));
  console.log(chalk.gray('Use ↑/↓ to navigate, SPACE to toggle selection, ENTER to delete, ESC to exit\n'));
  console.log(chalk.gray('Selected files will be moved to .deadfile-trash\n'));
  
  const allSelected = files.every(f => f.selected);
  const noneSelected = files.every(f => !f.selected);
  
  console.log(chalk.gray(`[${allSelected ? 'x' : noneSelected ? ' ' : '-'}] Select All / Deselect All`));
  console.log('');
  
  files.forEach((file, index) => {
    const isSelected = index === selectedIndex;
    const marker = file.selected ? chalk.green('✓') : ' ';
    const line = isSelected ? chalk.cyan('› ') + marker + ' ' + file.path : '  ' + marker + ' ' + file.path;
    console.log(line);
  });
  
  console.log('');
  const selectedCount = files.filter(f => f.selected).length;
  console.log(chalk.gray(`Selected: ${selectedCount} file(s) | Press ENTER to delete`));
}

async function interactiveDelete(files: FileItem[]): Promise<FileItem[]> {
  return new Promise((resolve) => {
    let selectedIndex = 0;
    renderList(files, selectedIndex);
    
    enableRawMode();
    
    const cleanup = () => {
      disableRawMode();
      rl.close();
    };
    
    process.stdin.on('data', (buf: Buffer) => {
      const key = buf.toString();
      
      if (key === '\u001b') {
        cleanup();
        resolve(files);
        return;
      }
      
      if (key === '\r') {
        cleanup();
        resolve(files);
        return;
      }
      
      if (key === '\u001b[A') {
        selectedIndex = Math.max(0, selectedIndex - 1);
        renderList(files, selectedIndex);
      } else if (key === '\u001b[B') {
        selectedIndex = Math.min(files.length - 1, selectedIndex + 1);
        renderList(files, selectedIndex);
      } else if (key === ' ') {
        if (selectedIndex === 0) {
          const allSelected = files.every(f => f.selected);
          files.forEach(f => f.selected = !allSelected);
        } else {
          files[selectedIndex].selected = !files[selectedIndex].selected;
        }
        renderList(files, selectedIndex);
      } else if (key === '\t') {
        const allSelected = files.every(f => f.selected);
        files.forEach(f => f.selected = !allSelected);
        renderList(files, selectedIndex);
      }
    });
  });
}

const program = new Command();

program
  .name('deadfile')
  .description('A CLI tool to detect unused files in JS/TS projects')
  .version('1.0.0');

program
  .option('-c, --config <path>', 'custom config path')
  .option('-j, --json', 'output JSON')
  .option('-d, --delete', 'move unused files')
  .option('-i, --interactive', 'confirm each delete')
  .option('-f, --fix-imports', 'remove unused imports and organize imports')
  .action(async (options) => {
    const cwd = process.cwd();
    const isJson = options.json;

    if (!isJson) {
      console.log(chalk.blue('🔍 Scanning project...'));
    }

    const startTime = Date.now();

    const config = loadConfig(options.config);
    const files = await scanFiles(config, cwd);
    const parser = new ImportParser(config.extensions);
    const graph = buildGraph(files, parser);
    const result = findUnusedFiles(files, graph, config.entry, cwd);

    const timeTaken = ((Date.now() - startTime) / 1000).toFixed(1);

    if (isJson) {
      console.log(JSON.stringify({
        unused: result.unusedFiles.map(f => path.relative(cwd, f)),
        possiblyUnused: result.possiblyUnusedFiles.map(f => path.relative(cwd, f))
      }, null, 2));
    } else {
      console.log('');
      console.log(chalk.red(`❌ Unused Files (${result.unusedFiles.length}):`));
      for (const file of result.unusedFiles) {
        console.log(`- ${path.relative(cwd, file)}`);
      }

      if (result.possiblyUnusedFiles.length > 0) {
        console.log('');
        console.log(chalk.yellow(`⚠️ Possibly Unused (dynamic import detected) (${result.possiblyUnusedFiles.length}):`));
        for (const file of result.possiblyUnusedFiles) {
          console.log(`- ${path.relative(cwd, file)}`);
        }
      }

      console.log('');
      console.log(chalk.green(`✅ Done in ${timeTaken}s (Scanned ${result.totalFiles} files)`));

      if (options.fixImports && files.length > 0) {
        console.log('');
        console.log(chalk.cyan('🔧 Fixing imports...'));
        const fixer = new ImportFixer(config.extensions);
        let fixedCount = 0;
        let removedCount = 0;

        for (const file of files) {
          const result = fixer.fixFile(file);
          if (result) {
            if (result.removedImports.length > 0) {
              removedCount += result.removedImports.length;
            }
            if (result.organized) {
              fixedCount++;
            }
          }
        }

        if (fixedCount > 0 || removedCount > 0) {
          console.log(chalk.green(`✅ Fixed imports in ${fixedCount} file(s)`));
          if (removedCount > 0) {
            console.log(chalk.yellow(`🗑️  Removed ${removedCount} unused import(s)`));
          }
        } else {
          console.log(chalk.gray('No import fixes needed'));
        }
      }

      if (options.delete && result.unusedFiles.length > 0) {
        const fs = await import('fs');
        
        if (options.interactive) {
          const fileItems: FileItem[] = result.unusedFiles.map(f => ({
            path: path.relative(cwd, f),
            selected: false
          }));
          
          const selectedFiles = await interactiveDelete(fileItems);
          const toDelete = selectedFiles.filter(f => f.selected);
          
          if (toDelete.length === 0) {
            console.log(chalk.yellow('\nNo files selected. Exiting.'));
            return;
          }
          
          console.log('');
          console.log(chalk.cyan(`🗑️  Moving ${toDelete.length} file(s) to .deadfile-trash...`));
          const trashDir = path.resolve(cwd, '.deadfile-trash');
          if (!fs.existsSync(trashDir)) {
            fs.mkdirSync(trashDir);
          }
          
          for (const file of toDelete) {
            const fullPath = path.resolve(cwd, file.path);
            const trashPath = path.resolve(trashDir, file.path.replace(/\\|\//g, '_'));
            const dir = path.dirname(trashPath);
            if (!fs.existsSync(dir)) {
              fs.mkdirSync(dir, { recursive: true });
            }
            try {
              fs.renameSync(fullPath, trashPath);
              console.log(chalk.gray(`Moved: ${file.path}`));
            } catch (e: any) {
              console.error(chalk.red(`Failed to move ${file.path}: ${e.message}`));
            }
          }
          console.log(chalk.green('✅ Cleanup complete! (Check .deadfile-trash to recover if needed)'));
        } else {
          console.log('');
          console.log(chalk.cyan('🗑️  Moving unused files to .deadfile-trash...'));
          const trashDir = path.resolve(cwd, '.deadfile-trash');
          if (!fs.existsSync(trashDir)) {
            fs.mkdirSync(trashDir);
          }

          for (const file of result.unusedFiles) {
            const relativePath = path.relative(cwd, file);
            const trashPath = path.resolve(trashDir, relativePath.replace(/\\|\//g, '_'));
            try {
              fs.renameSync(file, trashPath);
              console.log(chalk.gray(`Moved: ${relativePath}`));
            } catch (e: any) {
              console.error(chalk.red(`Failed to move ${relativePath}: ${e.message}`));
            }
          }
          console.log(chalk.green('✅ Cleanup complete! (Check .deadfile-trash to recover if needed)'));
        }
      }
    }
  });

program.parse();
