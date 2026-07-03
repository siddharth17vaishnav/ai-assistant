import path from "path";
import { Project, SyntaxKind } from "ts-morph";

import { config } from "../core/config.js";
import { listProjectPaths } from "../indexing/loader.js";
import type { ReferenceMatch } from "../core/types.js";

let projectCache: Project | null = null;

function getProject(): Project {
  if (!projectCache) {
    projectCache = new Project({
      compilerOptions: {
        allowJs: true,
        jsx: 2,
      },
      skipAddingFilesFromTsConfig: true,
    });
  }

  return projectCache;
}

async function ensureSourceFiles(): Promise<Project> {
  const project = getProject();
  const paths = await listProjectPaths();
  const codePaths = paths.filter((filePath) =>
    /\.(ts|tsx|js|jsx)$/.test(filePath),
  );

  for (const relativePath of codePaths) {
    const fullPath = path.join(config.projectPath, relativePath);

    if (!project.getSourceFile(fullPath)) {
      project.addSourceFileAtPath(fullPath);
    }
  }

  return project;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function moduleMatchesFile(
  moduleSpecifier: string,
  relativePath: string,
): boolean {
  const normalizedPath = normalizePath(relativePath);
  const withoutExt = normalizedPath.replace(/\.(tsx?|jsx?)$/, "");
  const baseName = path.basename(withoutExt);
  const spec = normalizePath(moduleSpecifier);

  return (
    spec === normalizedPath ||
    spec === withoutExt ||
    spec.endsWith(`/${baseName}`) ||
    spec.endsWith(baseName) ||
    spec.includes(withoutExt)
  );
}

export async function findImporters(
  relativePath: string,
  maxResults = 25,
): Promise<ReferenceMatch[]> {
  const project = await ensureSourceFiles();
  const matches: ReferenceMatch[] = [];
  const target = normalizePath(relativePath);

  for (const sourceFile of project.getSourceFiles()) {
    if (matches.length >= maxResults) break;

    const filePath = normalizePath(
      path.relative(config.projectPath, sourceFile.getFilePath()),
    );

    if (filePath === target) continue;

    for (const declaration of sourceFile.getImportDeclarations()) {
      const moduleSpecifier = declaration.getModuleSpecifierValue();

      if (!moduleMatchesFile(moduleSpecifier, relativePath)) {
        continue;
      }

      matches.push({
        path: filePath,
        line: declaration.getStartLineNumber(),
        kind: "import",
        text: declaration.getText().split("\n")[0],
      });
    }
  }

  return matches;
}

export function formatImporterResults(matches: ReferenceMatch[]): string {
  if (matches.length === 0) {
    return "No importers found.";
  }

  return formatReferenceResults(matches);
}

export async function findReferences(
  symbolName: string,
  maxResults = 30,
): Promise<ReferenceMatch[]> {
  const project = await ensureSourceFiles();
  const matches: ReferenceMatch[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    if (matches.length >= maxResults) break;

    sourceFile.forEachDescendant((node) => {
      if (matches.length >= maxResults) return;

      if (
        node.getKind() === SyntaxKind.Identifier &&
        node.getText() === symbolName
      ) {
        const line = node.getStartLineNumber();
        const parent = node.getParent();

        matches.push({
          path: path.relative(config.projectPath, sourceFile.getFilePath()),
          line,
          kind: parent?.getKindName() ?? "reference",
          text: parent?.getText().split("\n")[0] ?? node.getText(),
        });
      }
    });
  }

  return matches;
}

export async function getImports(relativePath: string): Promise<string[]> {
  const project = await ensureSourceFiles();
  const fullPath = path.join(config.projectPath, relativePath);
  const sourceFile =
    project.getSourceFile(fullPath) ?? project.addSourceFileAtPath(fullPath);

  return sourceFile.getImportDeclarations().map((declaration) => {
    const moduleSpecifier = declaration.getModuleSpecifierValue();
    const named = declaration
      .getNamedImports()
      .map((item) => item.getName())
      .join(", ");

    return named ? `${moduleSpecifier} → { ${named} }` : moduleSpecifier;
  });
}

export function formatReferenceResults(matches: ReferenceMatch[]): string {
  if (matches.length === 0) {
    return "No references found.";
  }

  return matches
    .map(
      (match) =>
        `${match.path}:${match.line} [${match.kind}] ${match.text}`,
    )
    .join("\n");
}

export function formatImports(imports: string[]): string {
  if (imports.length === 0) {
    return "No imports found.";
  }

  return imports.map((item) => `  - ${item}`).join("\n");
}

export function resetProjectCache() {
  projectCache = null;
}
