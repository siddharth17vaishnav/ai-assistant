import { retrieveHybrid } from "../retrieval/retriever.js";
import { syncIndex } from "../indexing/syncIndex.js";
import { getGitSummary, getRecentDiff } from "./git.js";
import { editProjectFile, readProjectLines } from "./editFile.js";
import { formatGrepResults, grep } from "./grep.js";
import {
  findReferences,
  findImporters,
  formatReferenceResults,
  formatImporterResults,
  formatImports,
  getImports,
  resetProjectCache,
} from "./references.js";
import { formatFileWithLineNumbers, readProjectFile } from "./readFile.js";
import { findSymbol, formatSymbolResults } from "./symbols.js";
import { writeProjectFile } from "./writeFile.js";
import {
  buildMutationDiffPreview,
  MUTATING_TOOLS,
} from "./diff.js";
import type { DiffPreview } from "../core/types.js";

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required: string[];
    };
  };
}

type ToolHandler = (args: Record<string, unknown>) => Promise<string>;

export interface ToolContext {
  confirm?: (preview: DiffPreview) => Promise<boolean>;
  readOnly?: boolean;
}

interface RegisteredTool {
  definition: ToolDefinition;
  execute: ToolHandler;
}

async function syncAfterWrite(message: string): Promise<string> {
  resetProjectCache();
  const result = await syncIndex({ quiet: true });
  const syncNote =
    result.mode === "unchanged"
      ? "Index already up to date."
      : `Index synced (${result.mode}).`;

  return `${message}\n${syncNote}`;
}

const registry: Record<string, RegisteredTool> = {
  search_codebase: {
    definition: {
      type: "function",
      function: {
        name: "search_codebase",
        description:
          "Semantic search over the indexed codebase. Use for conceptual questions.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
          },
          required: ["query"],
        },
      },
    },
    execute: async (args) => {
      const query = String(args.query ?? "");
      const results = await retrieveHybrid(query);

      if (results.length === 0) {
        return "No results found.";
      }

      return results
        .map(
          (chunk, index) =>
            `[${index + 1}] ${chunk.path}:${chunk.startLine}-${chunk.endLine}\n${chunk.text}`,
        )
        .join("\n\n---\n\n");
    },
  },

  read_file: {
    definition: {
      type: "function",
      function: {
        name: "read_file",
        description: "Read a file or a line range from the project.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Relative file path" },
            start_line: { type: "number", description: "Optional start line" },
            end_line: { type: "number", description: "Optional end line" },
          },
          required: ["path"],
        },
      },
    },
    execute: async (args) => {
      const filePath = String(args.path ?? "");

      if (args.start_line != null && args.end_line != null) {
        const text = await readProjectLines(
          filePath,
          Number(args.start_line),
          Number(args.end_line),
        );
        return `${filePath}:${args.start_line}-${args.end_line}\n${text}`;
      }

      const content = await readProjectFile(filePath);
      return formatFileWithLineNumbers(filePath, content);
    },
  },

  grep: {
    definition: {
      type: "function",
      function: {
        name: "grep",
        description: "Regex search across project files.",
        parameters: {
          type: "object",
          properties: {
            pattern: { type: "string", description: "Regex pattern" },
          },
          required: ["pattern"],
        },
      },
    },
    execute: async (args) => {
      return formatGrepResults(await grep(String(args.pattern ?? ""), 25));
    },
  },

  find_symbol: {
    definition: {
      type: "function",
      function: {
        name: "find_symbol",
        description: "Find where a function, class, or type is defined.",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: "Symbol name" },
          },
          required: ["name"],
        },
      },
    },
    execute: async (args) => {
      return formatSymbolResults(await findSymbol(String(args.name ?? "")));
    },
  },

  find_references: {
    definition: {
      type: "function",
      function: {
        name: "find_references",
        description: "Find all references to a symbol using the AST.",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: "Symbol name" },
          },
          required: ["name"],
        },
      },
    },
    execute: async (args) => {
      return formatReferenceResults(
        await findReferences(String(args.name ?? "")),
      );
    },
  },

  list_imports: {
    definition: {
      type: "function",
      function: {
        name: "list_imports",
        description: "List imports in a TypeScript/JavaScript file.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Relative file path" },
          },
          required: ["path"],
        },
      },
    },
    execute: async (args) => {
      return formatImports(await getImports(String(args.path ?? "")));
    },
  },

  find_importers: {
    definition: {
      type: "function",
      function: {
        name: "find_importers",
        description: "Find files that import a given module file.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Relative file path" },
          },
          required: ["path"],
        },
      },
    },
    execute: async (args) => {
      return formatImporterResults(
        await findImporters(String(args.path ?? "")),
      );
    },
  },

  git_status: {
    definition: {
      type: "function",
      function: {
        name: "git_status",
        description: "Get git status and recent diff summary.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
      },
    },
    execute: async () => {
      const [summary, diff] = await Promise.all([
        getGitSummary(),
        getRecentDiff(80),
      ]);

      return `${summary}\n\nRecent diff:\n${diff || "(no diff)"}`;
    },
  },

  edit_file: {
    definition: {
      type: "function",
      function: {
        name: "edit_file",
        description:
          "Replace a line range in a file with new content. Use for targeted edits.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Relative file path" },
            start_line: { type: "number", description: "First line to replace" },
            end_line: { type: "number", description: "Last line to replace" },
            content: { type: "string", description: "New content" },
          },
          required: ["path", "start_line", "end_line", "content"],
        },
      },
    },
    execute: async (args) => {
      const filePath = String(args.path ?? "");
      await editProjectFile(
        filePath,
        Number(args.start_line),
        Number(args.end_line),
        String(args.content ?? ""),
      );

      return syncAfterWrite(`Edited ${filePath}:${args.start_line}-${args.end_line}`);
    },
  },

  write_file: {
    definition: {
      type: "function",
      function: {
        name: "write_file",
        description: "Write or overwrite an entire file.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Relative file path" },
            content: { type: "string", description: "Full file content" },
          },
          required: ["path", "content"],
        },
      },
    },
    execute: async (args) => {
      const filePath = String(args.path ?? "");
      await writeProjectFile(filePath, String(args.content ?? ""));
      return syncAfterWrite(`Wrote ${filePath}`);
    },
  },
};

export function getToolDefinitions(options?: { readOnly?: boolean }): ToolDefinition[] {
  return getToolNames(options).map((name) => registry[name]!.definition);
}

export function getToolNames(options?: { readOnly?: boolean }): string[] {
  const names = Object.keys(registry);

  if (options?.readOnly) {
    return names.filter((name) => !MUTATING_TOOLS.has(name));
  }

  return names;
}

export function isMutatingTool(name: string): boolean {
  return MUTATING_TOOLS.has(name);
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  context?: ToolContext,
): Promise<string> {
  const tool = registry[name];

  if (!tool) {
    throw new Error(`Unknown tool: ${name}`);
  }

  if (context?.readOnly && MUTATING_TOOLS.has(name)) {
    return "Plan mode is read-only. Use read/search tools to explore, then finalize your plan. The user can run /execute to implement changes.";
  }

  if (MUTATING_TOOLS.has(name)) {
    const preview = await buildMutationDiffPreview(name, args);

    if (context?.confirm) {
      const approved = await context.confirm(preview);

      if (!approved) {
        return "Edit cancelled by user.";
      }
    }
  }

  return tool.execute(args);
}

export async function syncProjectAfterWrite(): Promise<void> {
  resetProjectCache();
  await syncIndex({ quiet: true });
}
