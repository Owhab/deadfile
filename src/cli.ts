#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import path from 'path';
import readline from 'readline';
import { loadConfig } from './config.js';
import { scanFiles } from './scanner.js';
import { ImportParser } from './parser.js';
import { buildGraph, findUnusedFiles } from './graph.js';
import { ImportFixer, type FileAnalysisResult } from './fixer.js';

interface FileItem {
  path: string;
  selected: boolean;
}

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
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

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
  .command('help')
  .description('Show available commands and options')
  .action(() => {
    console.log(`
${chalk.cyan('✂️  CodePrune - Available Commands:')}

${chalk.bold('Commands:')}
  ${chalk.green('init [framework]')}    Initialize codeprune.config.json
  ${chalk.green('restore')}            Restore deleted files from trash
  ${chalk.green('help')}                Show this help message

${chalk.bold('Options:')}
  ${chalk.green('-c, --config <path>')}   Custom config file path
  ${chalk.green('-j, --json')}             Output results in JSON format
  ${chalk.green('-d, --delete')}           Move unused files to trash
  ${chalk.green('-i, --interactive')}      Interactive file selection
  ${chalk.green('-f, --fix-imports')}      Remove unused imports & organize
  ${chalk.green('-y, --yes')}              Auto-detect and use framework
  ${chalk.green('-h, --help')}             Display help

${chalk.bold('Examples:')}
  codeprune init              # Interactive selection (auto-detect)
  codeprune init --yes        # Auto-detect and create config
  codeprune init react       # Use specific framework
  codeprune --json
  codeprune --delete --interactive
  codeprune --fix-imports
  codeprune restore --all

${chalk.gray('For more info: https://github.com/yourusername/codeprune')}
`);
  });

program
  .command('init [framework]')
  .description('Initialize codeprune.config.json (framework: next, react, react-native, node, vue, svelte, express)')
  .option('-o, --output <path>', 'output file path', 'codeprune.config.json')
  .option('-y, --yes', 'auto-detect and use framework')
  .action(async (framework, options) => {
    const fs = await import('fs');
    const cwd = process.cwd();
    const frameworks = ['next', 'react', 'react-native', 'node', 'vue', 'svelte', 'express'];

    const detectFramework = (): string | null => {
      const packageJsonPath = path.resolve(cwd, 'package.json');
      if (fs.existsSync(packageJsonPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
          const deps = { ...pkg.dependencies, ...pkg.devDependencies };
          
          if (deps['next'] || pkg.scripts?.dev?.includes('next')) return 'next';
          if (deps['react-native']) return 'react-native';
          if (deps['@sveltejs/kit'] || deps['svelte']) return 'svelte';
          if (deps['vue']) return 'vue';
          if (deps['express']) return 'express';
          if (deps['react'] || deps['react-dom']) return 'react';
        } catch (e) {}
      }

      if (fs.existsSync(path.resolve(cwd, 'next.config.js'))) return 'next';
      if (fs.existsSync(path.resolve(cwd, 'vite.config.ts')) || fs.existsSync(path.resolve(cwd, 'vite.config.js'))) return 'react';
      if (fs.existsSync(path.resolve(cwd, 'svelte.config.js'))) return 'svelte';
      if (fs.existsSync(path.resolve(cwd, 'nuxt.config.ts'))) return 'next';

      return null;
    };

    const configs: Record<string, any> = {
      next: {
        include: ['src', 'app', 'pages', 'lib', 'utils', 'components', 'hooks', 'types'],
        exclude: ['node_modules', '.next', 'out', 'public', '.git', 'coverage', '.cache',
          'babel.config.js', 'eslint.config.js', 'tailwind.config.js', 'metro.config.js'],
        extensions: ['.js', '.ts', '.tsx', '.jsx'],
        entry: ['app', 'pages', 'src', 'index.js', 'App.tsx', 'src/index.ts', 'src/main.ts']
      },
      react: {
        include: ['src', 'lib', 'utils', 'components', 'hooks', 'pages', 'screens', 'types'],
        exclude: ['node_modules', 'dist', 'build', '.git', 'coverage', '.cache',
          'babel.config.js', 'eslint.config.js', 'tailwind.config.js', 'vite.config.ts', 'vite.config.js'],
        extensions: ['.js', '.ts', '.tsx', '.jsx'],
        entry: ['App.tsx', 'App.js', 'index.js', 'index.tsx', 'src/main.tsx', 'src/index.tsx', 'src/App.tsx']
      },
      'react-native': {
        include: ['src', 'lib', 'utils', 'components', 'screens', 'hooks', 'types', 'ios', 'android'],
        exclude: ['node_modules', 'android', 'ios', '.expo', '.git', 'coverage', '.cache',
          'babel.config.js', 'metro.config.js', 'eslint.config.js', 'tailwind.config.js', '.npm'],
        extensions: ['.js', '.ts', '.tsx', '.jsx'],
        entry: ['App.tsx', 'App.js', 'index.js', 'index.ts', 'src/App.tsx', 'src/index.ts']
      },
      node: {
        include: ['src', 'lib', 'utils', 'controllers', 'services', 'models', 'routes', 'middleware', 'types'],
        exclude: ['node_modules', 'dist', '.git', 'coverage', '.cache'],
        extensions: ['.js', '.ts'],
        entry: ['index.js', 'index.ts', 'src/index.ts', 'src/main.ts', 'src/app.ts', 'app.js']
      },
      vue: {
        include: ['src', 'components', 'views', 'composables', 'router', 'stores', 'types', 'assets'],
        exclude: ['node_modules', 'dist', '.git', 'coverage', '.cache',
          'vite.config.ts', 'vite.config.js', 'eslint.config.js'],
        extensions: ['.js', '.ts', '.vue', '.jsx', '.tsx'],
        entry: ['App.vue', 'src/main.ts', 'src/main.js', 'src/App.vue', 'main.ts', 'main.js']
      },
      svelte: {
        include: ['src', 'routes', 'lib', 'components', 'stores', 'types'],
        exclude: ['node_modules', 'dist', '.git', 'coverage', '.cache',
          'svelte.config.js', 'vite.config.ts', 'eslint.config.js'],
        extensions: ['.js', '.ts', '.svelte', '.jsx', '.tsx'],
        entry: ['App.svelte', 'src/main.ts', 'src/main.js', 'src/App.svelte', 'src/routes', 'routes']
      },
      express: {
        include: ['src', 'controllers', 'services', 'models', 'routes', 'middleware', 'utils', 'types'],
        exclude: ['node_modules', 'dist', '.git', 'coverage', '.cache'],
        extensions: ['.js', '.ts'],
        entry: ['index.js', 'index.ts', 'src/index.ts', 'src/main.ts', 'src/app.ts', 'app.js', 'server.js']
      }
    };

    let f = framework?.toLowerCase();
    const detected = detectFramework();

    if (!f) {
      if (detected && options.yes) {
        f = detected;
        console.log(chalk.cyan(`🔍 Detected framework: ${chalk.bold(detected)}`));
      } else if (detected) {
        console.log(chalk.cyan(`🔍 Detected framework: ${chalk.bold(detected)}`));
        console.log(chalk.gray(`  Press Enter to use this or type a different framework.\n`));
        
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout
        });
        
        await new Promise<void>((resolve) => {
          rl.question(chalk.gray(`Select framework (${frameworks.join(', ')}): `), (answer) => {
            rl.close();
            if (answer.trim()) {
              f = answer.trim().toLowerCase();
            } else {
              f = detected;
            }
            resolve();
          });
        });
      } else {
        if (options.yes) {
          f = 'node';
          console.log(chalk.yellow('⚠️ Could not detect framework, using default: node'));
        } else {
          console.log(chalk.yellow(`Could not auto-detect framework. Please specify one:`));
          console.log(chalk.gray(`Usage: codeprune init <${frameworks.join('|')}>`));
          return;
        }
      }
    }

    if (!frameworks.includes(f)) {
      console.log(chalk.red(`Invalid framework: ${f}`));
      console.log(chalk.gray(`Valid options: ${frameworks.join(', ')}`));
      return;
    }

    const config = configs[f];
    const outputPath = path.resolve(cwd, options.output);

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

      const fixer = new ImportFixer(config.extensions);
      let totalUnusedImports = 0;
      let totalUnusedDeclarations = 0;
      const filesWithIssues: { file: string; imports: string[]; declarations: string[] }[] = [];

      for (const file of files) {
        const analysis = fixer.analyzeFile(file);
        if (analysis && (analysis.unusedImports.length > 0 || analysis.unusedDeclarations.length > 0)) {
          totalUnusedImports += analysis.unusedImports.length;
          totalUnusedDeclarations += analysis.unusedDeclarations.length;
          filesWithIssues.push({
            file: path.relative(cwd, file),
            imports: analysis.unusedImports,
            declarations: analysis.unusedDeclarations
          });
        }
      }

      if (filesWithIssues.length > 0) {
        console.log('');
        console.log(chalk.cyan('📦 Unused Imports & Declarations:'));
        for (const f of filesWithIssues) {
          if (f.imports.length > 0) {
            console.log(chalk.yellow(`  ${f.file}:`));
            for (const imp of f.imports) {
              console.log(chalk.gray(`    import ${imp}`));
            }
          }
          if (f.declarations.length > 0) {
            console.log(chalk.yellow(`  ${f.file}:`));
            for (const decl of f.declarations) {
              console.log(chalk.gray(`    ${decl}`));
            }
          }
        }
        console.log(chalk.gray(`  Total: ${totalUnusedImports} unused import(s), ${totalUnusedDeclarations} unused declaration(s)`));
      }

      if (options.fixImports && files.length > 0) {
        console.log('');
        console.log(chalk.cyan('🔧 Fixing imports and declarations...'));
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
