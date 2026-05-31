import { Project, SyntaxKind, Node } from 'ts-morph';
import path from 'path';
import fs from 'fs';

export interface ParsedDependencies {
  static: string[];
  dynamic: string[];
}

interface TsConfigPaths {
  baseUrl: string;
  paths: Record<string, string[]>;
}

function loadTsConfigPaths(cwd: string): TsConfigPaths | null {
  for (const configFile of ['tsconfig.json', 'jsconfig.json']) {
    const configPath = path.resolve(cwd, configFile);
    if (!fs.existsSync(configPath)) continue;

    try {
      const content = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const compilerOptions = content?.compilerOptions;
      if (!compilerOptions) continue;

      const baseUrl = compilerOptions.baseUrl || '.';
      const paths = compilerOptions.paths || {};

      if (Object.keys(paths).length > 0) {
        return { baseUrl, paths };
      }
    } catch {
      continue;
    }
  }
  return null;
}

function resolveWithPaths(specifier: string, tsConfigPaths: TsConfigPaths, cwd: string): string | null {
  const { baseUrl, paths } = tsConfigPaths;
  const baseUrlResolved = path.resolve(cwd, baseUrl);

  for (const [pattern, mappings] of Object.entries(paths)) {
    const regexStr = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\\\*/g, '(.+)');
    const regex = new RegExp(`^${regexStr}$`);
    const match = specifier.match(regex);

    if (!match) continue;

    for (const mapping of mappings) {
      const resolved = mapping.replace('*', match[1]);
      const fullPath = path.resolve(baseUrlResolved, resolved);
      return fullPath;
    }
  }
  return null;
}

export class ImportParser {
  private project: Project;
  private extensions: string[];
  private tsConfigPaths: TsConfigPaths | null;

  constructor(extensions: string[]) {
    this.extensions = extensions;
    this.project = new Project({
      compilerOptions: {
        allowJs: true,
        resolveJsonModule: true,
      },
      skipAddingFilesFromTsConfig: true,
    });
    this.tsConfigPaths = loadTsConfigPaths(process.cwd());
  }

  public parseFile(filePath: string): ParsedDependencies {
    const deps: ParsedDependencies = { static: [], dynamic: [] };
    
    let sourceFile = this.project.getSourceFile(filePath);
    if (!sourceFile) {
      if (!fs.existsSync(filePath)) {
        return deps;
      }
      sourceFile = this.project.addSourceFileAtPath(filePath);
    }

    // 1. Static imports: `import x from 'y'`
    for (const decl of sourceFile.getImportDeclarations()) {
      const mod = decl.getModuleSpecifierValue();
      if (mod) {
        const resolved = this.resolveModulePath(filePath, mod);
        if (resolved) deps.static.push(resolved);
      }
    }

    // 2. Export declarations: `export * from 'y'`
    for (const decl of sourceFile.getExportDeclarations()) {
      if (decl.hasModuleSpecifier()) {
        const mod = decl.getModuleSpecifierValue();
        if (mod) {
          const resolved = this.resolveModulePath(filePath, mod);
          if (resolved) deps.static.push(resolved);
        }
      }
    }

    // 3. Requires and dynamic imports
    sourceFile.forEachDescendant(node => {
      if (Node.isCallExpression(node)) {
        const expression = node.getExpression();
        
        // require('y')
        if (Node.isIdentifier(expression) && expression.getText() === 'require') {
          const args = node.getArguments();
          if (args.length > 0 && Node.isStringLiteral(args[0])) {
            const resolved = this.resolveModulePath(filePath, args[0].getLiteralValue());
            if (resolved) deps.static.push(resolved);
          }
        }
        
        // import('y')
        if (node.getExpression().getKind() === SyntaxKind.ImportKeyword) {
          const args = node.getArguments();
          if (args.length > 0 && Node.isStringLiteral(args[0])) {
            const resolved = this.resolveModulePath(filePath, args[0].getLiteralValue());
            if (resolved) deps.dynamic.push(resolved);
          }
        }
      }
    });

    return deps;
  }

  private resolveModulePath(fromFile: string, specifier: string): string | null {
    if (!specifier.startsWith('.')) {
      if (path.isAbsolute(specifier)) {
        const resolved = this.tryResolve(specifier);
        if (resolved) return resolved;
      }
      
      // tsconfig/jsconfig paths resolution
      if (this.tsConfigPaths) {
        const mapped = resolveWithPaths(specifier, this.tsConfigPaths, process.cwd());
        if (mapped) {
          const resolved = this.tryResolve(mapped);
          if (resolved) return resolved;
        }
      }

      // Basic alias support for @/ and ~/
      if (specifier.startsWith('@/') || specifier.startsWith('~/')) {
        const relativeSpecifier = specifier.substring(2);
        
        // Try mapping from root
        let aliasPath = path.resolve(process.cwd(), relativeSpecifier);
        let resolved = this.tryResolve(aliasPath);
        if (resolved) return resolved;

        // Try mapping from src/
        aliasPath = path.resolve(process.cwd(), 'src', relativeSpecifier);
        resolved = this.tryResolve(aliasPath);
        if (resolved) return resolved;
      }

      // Skip npm modules
      return null;
    }

    const resolvedPath = path.resolve(path.dirname(fromFile), specifier);
    return this.tryResolve(resolvedPath);
  }

  private tryResolve(resolvedPath: string): string | null {
    const esmFallbackMap: Record<string, string[]> = {
      '.js': ['.ts', '.tsx'],
      '.jsx': ['.tsx'],
      '.mjs': ['.mts'],
      '.cjs': ['.cts'],
    };

    for (const [fromExt, toExts] of Object.entries(esmFallbackMap)) {
      if (resolvedPath.endsWith(fromExt) && !fs.existsSync(resolvedPath)) {
        const withoutExt = resolvedPath.slice(0, -fromExt.length);
        for (const toExt of toExts) {
          if (fs.existsSync(withoutExt + toExt)) {
            return path.normalize(withoutExt + toExt);
          }
        }
      }
    }

    // Direct match
    if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
      return path.normalize(resolvedPath);
    }

    // Extensions
    for (const ext of this.extensions) {
      const withExt = `${resolvedPath}${ext}`;
      if (fs.existsSync(withExt) && fs.statSync(withExt).isFile()) {
        return path.normalize(withExt);
      }
    }

    // Index files
    for (const ext of this.extensions) {
      const indexPath = path.join(resolvedPath, `index${ext}`);
      if (fs.existsSync(indexPath) && fs.statSync(indexPath).isFile()) {
        return path.normalize(indexPath);
      }
    }

    return null;
  }
}
