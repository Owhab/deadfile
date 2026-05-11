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
  console.log(chalk.gray('Selected files will be moved to .codeprune-trash\n'));
  
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
  .name('codeprune')
  .description('A CLI tool to detect and clean up unused files and imports in JS/TS projects')
  .version('1.0.0');

program
  .command('init [framework]')
  .description('Initialize codeprune.config.json (framework: next, react, react-native, node, vue, svelte, express)')
  .option('-o, --output <path>', 'output file path', 'codeprune.config.json')
  .action(async (framework, options) => {
    const fs = await import('fs');
    const frameworks = ['next', 'react', 'react-native', 'node', 'vue', 'svelte', 'express'];
    const f = framework?.toLowerCase();

    if (!f || !frameworks.includes(f)) {
      console.log(chalk.yellow(`Please specify a framework: ${frameworks.join(', ')}`));
      console.log(chalk.gray('Usage: deadfile init <framework>'));
      return;
    }

    const configs: Record<string, any> = {
      next: {
        include: ['src', 'app', 'pages', 'components'],
        exclude: ['node_modules', '.next', 'out', 'public', '.git'],
        extensions: ['.js', '.ts', '.tsx', '.jsx'],
        entry: ['app', 'pages']
      },
      react: {
        include: ['src'],
        exclude: ['node_modules', 'dist', 'build', '.git'],
        extensions: ['.js', '.ts', '.tsx', '.jsx'],
        entry: ['src/main.tsx', 'src/index.tsx', 'src/App.tsx']
      },
      'react-native': {
        include: ['src', 'components', 'screens'],
        exclude: ['node_modules', 'android', 'ios', '.expo', '.git'],
        extensions: ['.js', '.ts', '.tsx', '.jsx'],
        entry: ['App.tsx', 'index.js', 'src/App.tsx']
      },
      node: {
        include: ['src'],
        exclude: ['node_modules', 'dist', '.git'],
        extensions: ['.js', '.ts'],
        entry: ['src/index.ts', 'src/main.ts', 'index.ts']
      },
      vue: {
        include: ['src'],
        exclude: ['node_modules', 'dist', '.git'],
        extensions: ['.js', '.ts', '.vue', '.jsx', '.tsx'],
        entry: ['src/main.ts', 'src/main.js']
      },
      svelte: {
        include: ['src', 'lib'],
        exclude: ['node_modules', 'dist', '.git'],
        extensions: ['.js', '.ts', '.svelte'],
        entry: ['src/main.ts', 'src/main.js', 'src/App.svelte']
      },
      express: {
        include: ['src', 'routes', 'controllers', 'middleware'],
        exclude: ['node_modules', 'dist', '.git'],
        extensions: ['.js', '.ts'],
        entry: ['src/index.ts', 'src/app.ts', 'app.js']
      }
    };

    const config = configs[f];
    const outputPath = path.resolve(process.cwd(), options.output);

    fs.writeFileSync(outputPath, JSON.stringify(config, null, 2));
    console.log(chalk.green(`✅ Created ${outputPath}`));
    console.log(chalk.gray(`\nFramework: ${f}`));
    console.log(chalk.gray(`Entry: ${config.entry.join(', ')}`));
  });

program
  .command('restore')
  .description('Restore deleted files from .codeprune-trash')
  .option('-a, --all', 'restore all files')
  .option('-f, --file <name>', 'restore specific file')
  .action(async (options) => {
    const fs = await import('fs');
    const cwd = process.cwd();
    const trashDir = path.resolve(cwd, '.codeprune-trash');
    const manifestPath = path.resolve(trashDir, '.codeprune-manifest.json');

    if (!fs.existsSync(trashDir)) {
      console.log(chalk.yellow('No .codeprune-trash folder found.'));
      return;
    }

    let manifest: Record<string, string> = {};
    if (fs.existsSync(manifestPath)) {
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      } catch (e) {
        manifest = {};
      }
    }

    if (options.all) {
      const files = fs.readdirSync(trashDir).filter(f => f !== '.codeprune-manifest.json');
      if (files.length === 0) {
        console.log(chalk.yellow('No files to restore.'));
        return;
      }

      let restored = 0;
      for (const file of files) {
        const originalPath = manifest[file] || file.replace(/_/g, path.sep);
        const trashPath = path.resolve(trashDir, file);
        const targetDir = path.dirname(path.resolve(cwd, originalPath));

        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }

        try {
          fs.renameSync(trashPath, path.resolve(cwd, originalPath));
          console.log(chalk.green(`Restored: ${originalPath}`));
          restored++;
        } catch (e: any) {
          console.error(chalk.red(`Failed to restore ${file}: ${e.message}`));
        }
      }

      if (fs.existsSync(manifestPath)) {
        fs.unlinkSync(manifestPath);
      }
      console.log(chalk.green(`\n✅ Restored ${restored} file(s)`));
    } else if (options.file) {
      const fileName = options.file.replace(/\\/g, '_').replace(/\//g, '_');
      const trashPath = path.resolve(trashDir, fileName);
      const originalPath = manifest[fileName] || options.file;

      if (!fs.existsSync(trashPath)) {
        console.log(chalk.red(`File not found in trash: ${options.file}`));
        return;
      }

      const targetDir = path.dirname(path.resolve(cwd, originalPath));
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      try {
        fs.renameSync(trashPath, path.resolve(cwd, originalPath));
        console.log(chalk.green(`✅ Restored: ${originalPath}`));

        delete manifest[fileName];
        if (Object.keys(manifest).length > 0) {
          fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
        } else if (fs.existsSync(manifestPath)) {
          fs.unlinkSync(manifestPath);
        }
      } catch (e: any) {
        console.error(chalk.red(`Failed to restore: ${e.message}`));
      }
    } else {
      const files = fs.readdirSync(trashDir).filter(f => f !== '.codeprune-manifest.json');
      if (files.length === 0) {
        console.log(chalk.yellow('No files to restore.'));
        return;
      }

      console.log(chalk.cyan('Files in .codeprune-trash:\n'));
      for (const file of files) {
        const original = manifest[file] || file.replace(/_/g, path.sep);
        console.log(`  ${chalk.gray(file)} → ${original}`);
      }
      console.log(chalk.gray('\nUse: deadfile restore --all to restore all'));
      console.log(chalk.gray('Use: deadfile restore --file "path/to/file" to restore specific'));
    }
  });

program
  .option('-c, --config <path>', 'custom config path')
  .option('-j, --json', 'output JSON')
  .option('-d, --delete', 'move unused files')
  .option('-i, --interactive', 'confirm each delete')
  .option('-f, --fix-imports', 'remove unused imports, variables, functions, classes and organize imports')
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
        console.log(chalk.cyan('🔧 Fixing imports and declarations...'));
        const fixer = new ImportFixer(config.extensions);
        let fixedCount = 0;
        let removedImports = 0;
        let removedDeclarations = 0;

        for (const file of files) {
          const res = fixer.fixFile(file);
          if (res) {
            if (res.removedImports.length > 0) {
              removedImports += res.removedImports.length;
            }
            if (res.removedDeclarations.length > 0) {
              removedDeclarations += res.removedDeclarations.length;
            }
            if (res.organized) {
              fixedCount++;
            }
          }
        }

        if (fixedCount > 0 || removedImports > 0 || removedDeclarations > 0) {
          console.log(chalk.green(`✅ Fixed imports in ${fixedCount} file(s)`));
          if (removedImports > 0) {
            console.log(chalk.yellow(`🗑️  Removed ${removedImports} unused import(s)`));
          }
          if (removedDeclarations > 0) {
            console.log(chalk.yellow(`🗑️  Removed ${removedDeclarations} unused declaration(s)`));
          }
        } else {
          console.log(chalk.gray('No fixes needed'));
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
          console.log(chalk.cyan(`🗑️  Moving ${toDelete.length} file(s) to .codeprune-trash...`));
          const trashDir = path.resolve(cwd, '.codeprune-trash');
          const manifestPath = path.resolve(trashDir, '.codeprune-manifest.json');
          if (!fs.existsSync(trashDir)) {
            fs.mkdirSync(trashDir);
          }

          let manifest: Record<string, string> = {};
          if (fs.existsSync(manifestPath)) {
            manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
          }
          
          for (const file of toDelete) {
            const fullPath = path.resolve(cwd, file.path);
            const trashFileName = file.path.replace(/\\|\//g, '_');
            const trashPath = path.resolve(trashDir, trashFileName);
            const dir = path.dirname(trashPath);
            if (!fs.existsSync(dir)) {
              fs.mkdirSync(dir, { recursive: true });
            }
            try {
              fs.renameSync(fullPath, trashPath);
              manifest[trashFileName] = file.path;
              console.log(chalk.gray(`Moved: ${file.path}`));
            } catch (e: any) {
              console.error(chalk.red(`Failed to move ${file.path}: ${e.message}`));
            }
          }

          fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
          console.log(chalk.green('✅ Cleanup complete! (Check .codeprune-trash to recover if needed)'));
        } else {
          console.log('');
          console.log(chalk.cyan('🗑️  Moving unused files to .codeprune-trash...'));
          const trashDir = path.resolve(cwd, '.codeprune-trash');
          const manifestPath = path.resolve(trashDir, '.codeprune-manifest.json');
          if (!fs.existsSync(trashDir)) {
            fs.mkdirSync(trashDir);
          }

          let manifest: Record<string, string> = {};
          if (fs.existsSync(manifestPath)) {
            manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
          }

          for (const file of result.unusedFiles) {
            const relativePath = path.relative(cwd, file);
            const trashFileName = relativePath.replace(/\\|\//g, '_');
            const trashPath = path.resolve(trashDir, trashFileName);
            try {
              fs.renameSync(file, trashPath);
              manifest[trashFileName] = relativePath;
              console.log(chalk.gray(`Moved: ${relativePath}`));
            } catch (e: any) {
              console.error(chalk.red(`Failed to move ${relativePath}: ${e.message}`));
            }
          }

          fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
          console.log(chalk.green('✅ Cleanup complete! (Check .codeprune-trash to recover if needed)'));
        }
      }
    }
  });

program.parse();
