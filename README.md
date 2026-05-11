# 💀 DeadFile

A fast, reliable CLI tool to detect and safely clean up unused files in your JS/TS projects (React, Next.js, React Native, Node.js). 

DeadFile parses your imports and builds a complete dependency graph starting from your entry points, flagging any source file that is completely unreachable.

## 🚀 Installation

For now, the easiest way to use this is to link it globally on your machine:

```bash
git clone <repository_url>
cd deadfile
npm install
npm run build
npm link
```

## 🔍 How to Scan Your Project

Once installed globally, you can use `deadfile` in any local JS/TS project.

### 1. Create a Configuration File
In the root directory of the project you want to scan, create a `deadfile.config.json` file. This tells DeadFile where to look and where your dependency graph starts.

**For Next.js:**
```json
{
  "include": ["src", "app", "pages", "components"],
  "exclude": ["node_modules", ".next", "out", "public"],
  "extensions": [".js", ".ts", ".tsx", ".jsx"],
  "entry": ["app", "pages"] 
}
```

**For React (Vite/Create React App):**
```json
{
  "include": ["src"],
  "exclude": ["node_modules", "dist", "build"],
  "extensions": [".js", ".ts", ".tsx", ".jsx"],
  "entry": ["src/main.tsx", "src/index.tsx"]
}
```

**For React Native:**
```json
{
  "include": ["src", "components", "screens"],
  "exclude": ["node_modules", "android", "ios", ".expo"],
  "extensions": [".js", ".ts", ".tsx", ".jsx"],
  "entry": ["App.tsx", "index.js"]
}
```

### 2. Run the Scanner
Run the following command in your terminal:
```bash
deadfile
```

You can also output the results in JSON format (ideal for CI/CD pipelines):
```bash
deadfile --json
```

---

## 🛠️ How to Fix (Clean Up) Unused Files

Once you have run the scanner, DeadFile will output a list of unused files. 

### Step 1: Review the Output
The CLI groups files into two categories:
* **❌ Unused Files:** Files that are definitely not imported anywhere in the graph. 
* **⚠️ Possibly Unused:** Files that are only referenced via dynamic imports (e.g., `import('./MyComponent')`). Static analysis cannot confidently guarantee these are unused, so verify manually!

### Step 2: Delete Unused Files using the `--delete` flag
DeadFile features a built-in safe delete mode. Rather than permanently deleting your files immediately, it moves them to a local trash folder.

Run the scan with the delete flag:
```bash
deadfile --delete
```

This will automatically:
1. Scan your project.
2. Identify the `❌ Unused Files`.
3. Move all unused files out of your workspace and into a `.deadfile-trash` folder in your project's root.

### Interactive Mode (Keyboard Navigation)

For more control over which files to delete, use the interactive mode:

```bash
deadfile --delete --interactive
```

This opens an interactive file selector where you can:

| Key | Action |
|-----|--------|
| `↑` / `↓` | Navigate through files |
| `Space` | Toggle file selection |
| `Tab` | Select/deselect all files |
| `Enter` | Delete selected files |
| `Escape` | Cancel and exit |

Files are moved to `.deadfile-trash` for safe recovery.

**What to check after running:**
1. Run your build/dev server (`npm run dev`) to ensure nothing broke. 
2. If a file was accidentally flagged as unused and your app broke, simply restore it from the `.deadfile-trash` folder.
3. Once you verify your project builds fine, you can permanently delete the `.deadfile-trash` folder.

---

## 🔧 Fix Unused Code

DeadFile can also clean up unused imports, variables, functions, classes, and more:

```bash
deadfile --fix-imports
```

This will:
1. **Remove unused imports** - Identifies imports that are never used in the file and removes them
2. **Remove unused declarations** - Removes unused variables, functions, classes, interfaces, and type aliases
3. **Organize imports** - Groups and sorts imports (external modules first, then relative imports, alphabetically sorted)

You can combine with other options:
```bash
deadfile --fix-imports --delete
```

---

## ⚙️ Configuration Reference

| Option | Type | Description |
|--------|------|-------------|
| `include` | `string[]` | Directories to recursively scan for source files. |
| `exclude` | `string[]` | Directories to completely ignore (e.g., `node_modules`). |
| `extensions`| `string[]` | File extensions to track (`.js, .tsx, .ts, etc.`). |
| `entry` | `string[]` | The starting points of your app. Can be specific files (`src/index.js`) or directories (`src/pages`). |
| `ignore` | `string[]` | Specific folders/patterns to skip within included directories. |

---

## ⌨️ CLI Options

| Option | Alias | Description |
|--------|-------|-------------|
| `--config` | `-c` | Custom config file path |
| `--json` | `-j` | Output results in JSON format |
| `--delete` | `-d` | Move unused files to `.deadfile-trash` |
| `--interactive` | `-i` | Interactive file selection (use with `--delete`) |
| `--fix-imports` | `-f` | Remove unused imports and organize imports |
