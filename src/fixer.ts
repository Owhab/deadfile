import { Project, SyntaxKind, Node, ImportDeclaration, ImportSpecifier, SourceFile, VariableDeclaration, FunctionDeclaration, ClassDeclaration, TypeAliasDeclaration, InterfaceDeclaration, MethodDeclaration, PropertyDeclaration, ParameterDeclaration, BindingElement } from 'ts-morph';
import path from 'path';
import fs from 'fs';

interface FileFixResult {
  file: string;
  removedImports: string[];
  removedDeclarations: string[];
  organized: boolean;
}

export class ImportFixer {
  private project: Project;
  private extensions: string[];

  constructor(extensions: string[]) {
    this.extensions = extensions;
    this.project = new Project({
      compilerOptions: {
        allowJs: true,
        resolveJsonModule: true,
      },
      skipAddingFilesFromTsConfig: true,
    });
  }

  public fixFile(filePath: string): FileFixResult | null {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const sourceFile = this.project.addSourceFileAtPath(filePath);
    const result: FileFixResult = {
      file: filePath,
      removedImports: [],
      removedDeclarations: [],
      organized: false,
    };

    const unusedSpecs = this.findUnusedImports(sourceFile);
    
    for (const spec of unusedSpecs) {
      const importDecl = spec.importDecl;
      importDecl.remove();
      result.removedImports.push(spec.specifier);
    }

    const unusedDecls = this.findUnusedDeclarations(sourceFile);
    for (const decl of unusedDecls) {
      const name = decl.getName();
      decl.remove();
      if (name) {
        result.removedDeclarations.push(name);
      }
    }

    this.organizeImports(sourceFile);
    result.organized = true;

    sourceFile.saveSync();
    return result;
  }

  private findUnusedDeclarations(sourceFile: SourceFile): any[] {
    const usedNames = new Set<string>();
    const declarations = new Map<string, any>();

    sourceFile.forEachDescendant((node) => {
      if (Node.isIdentifier(node)) {
        const text = node.getText();
        if (text && /^[a-zA-Z_]/.test(text)) {
          usedNames.add(text);
        }
      }
    });

    for (const func of sourceFile.getFunctions()) {
      const name = func.getName();
      if (name) declarations.set(name, func);
    }

    for (const cls of sourceFile.getClasses()) {
      const name = cls.getName();
      if (name) declarations.set(name, cls);
    }

    for (const iface of sourceFile.getInterfaces()) {
      const name = iface.getName();
      if (name) declarations.set(name, iface);
    }

    for (const typeAlias of sourceFile.getTypeAliases()) {
      const name = typeAlias.getName();
      if (name) declarations.set(name, typeAlias);
    }

    for (const varStmt of sourceFile.getVariableStatements()) {
      for (const decl of varStmt.getDeclarations()) {
        const name = decl.getName();
        if (name) declarations.set(name, decl);
      }
    }

    const unused: any[] = [];
    for (const [name, decl] of declarations) {
      if (!usedNames.has(name)) {
        unused.push(decl);
      }
    }

    return unused;
  }

  private findUnusedImports(sourceFile: SourceFile): { importDecl: ImportDeclaration; specifier: string }[] {
    const unused: { importDecl: ImportDeclaration; specifier: string }[] = [];
    const usedNames = new Set<string>();

    sourceFile.forEachDescendant((node) => {
      if (Node.isIdentifier(node)) {
        const text = node.getText();
        if (text && /^[a-z_]/.test(text)) {
          usedNames.add(text);
        }
      }
    });

    for (const decl of sourceFile.getImportDeclarations()) {
      const specifier = decl.getModuleSpecifierValue();
      const defaultImport = decl.getDefaultImport();
      const namespaceImport = decl.getNamespaceImport();
      const namedImports = decl.getNamedImports();

      if (defaultImport) {
        const name = defaultImport.getText();
        if (!usedNames.has(name)) {
          unused.push({ importDecl: decl, specifier });
        }
      }

      if (namespaceImport) {
        const name = namespaceImport.getText();
        if (!usedNames.has(name)) {
          unused.push({ importDecl: decl, specifier });
        }
      }

      for (const named of namedImports) {
        const name = named.getText();
        if (!usedNames.has(name)) {
          unused.push({ importDecl: decl, specifier });
          break;
        }
      }
    }

    return unused;
  }

  private organizeImports(sourceFile: SourceFile): void {
    const imports = sourceFile.getImportDeclarations();
    if (imports.length === 0) return;

    const external: ImportDeclaration[] = [];
    const relative: ImportDeclaration[] = [];

    for (const imp of imports) {
      const spec = imp.getModuleSpecifierValue();
      if (spec.startsWith('.') || spec.startsWith('/')) {
        relative.push(imp);
      } else {
        external.push(imp);
      }
    }

    const body = sourceFile.getStatements();
    const firstStatement = body[0];
    
    if (!firstStatement) return;

    const insertPos = firstStatement.getStart();
    const texts: string[] = [];

    for (const imp of external) {
      texts.push(imp.getFullText());
      imp.remove();
    }
    for (const imp of relative) {
      texts.push(imp.getFullText());
      imp.remove();
    }

    const externalSpecs = texts.slice(0, external.length).sort();
    const relativeSpecs = texts.slice(external.length).sort();
    const sortedTexts = [...externalSpecs, ...relativeSpecs];
    
    sourceFile.insertText(insertPos, sortedTexts.join('\n') + '\n\n');
  }
}