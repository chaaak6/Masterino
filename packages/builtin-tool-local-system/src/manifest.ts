import { type BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { LocalSystemApiName, LocalSystemIdentifier } from './types';

const officeVersionParameter = {
  type: 'string' as const,
  description:
    'Optional change-detection token: copy exactly from a previous Office tool result for this path. Omit on the first call. Attachment content hashes are not Office versions.',
};

export const LocalSystemManifest: BuiltinToolManifest = {
  executors: ['client', 'server'],
  api: [
    {
      name: 'batchOfficeDocument',
      description:
        'Edit literal cell values in a simple xlsx and save to a NEW outputPath. Source remains unchanged. Max10000 operations, source10MiB/expanded64MiB. Untouched formulas preserved without recalculation. Rejects complex drawings/charts/macros/pivots/external links. Does not guarantee arbitrary formatting preservation.',
      humanIntervention: {
        dynamic: { default: 'never', policy: 'required', type: 'pathScopeAudit' },
      },
      parameters: {
        type: 'object',
        required: ['path', 'outputPath', 'operations'],
        properties: {
          path: { type: 'string' },
          outputPath: { type: 'string' },
          version: officeVersionParameter,
          operations: {
            type: 'array',
            items: {
              type: 'object',
              required: ['sheet', 'cell', 'value'],
              properties: { sheet: { type: 'string' }, cell: { type: 'string' }, value: {} },
            },
          },
        },
      },
    },
    {
      name: 'mergeOfficeTemplate',
      description:
        'Replace {{key}} placeholders in simple xlsx literal string cells using values, writing a NEW outputPath. Formulas are untouched. Same finite workbook feature and size limits as batchOfficeDocument.',
      humanIntervention: {
        dynamic: { default: 'never', policy: 'required', type: 'pathScopeAudit' },
      },
      parameters: {
        type: 'object',
        required: ['path', 'outputPath', 'values'],
        properties: {
          path: { type: 'string' },
          outputPath: { type: 'string' },
          version: officeVersionParameter,
          values: { type: 'object', additionalProperties: { type: 'string' } },
        },
      },
    },
    {
      name: 'validateOfficeDocument',
      description:
        'Validate supported local xlsx package structure and feature/size limits. Does not recalculate formulas or validate visual appearance.',
      humanIntervention: {
        dynamic: { default: 'never', policy: 'required', type: 'pathScopeAudit' },
      },
      parameters: {
        type: 'object',
        required: ['path'],
        properties: { path: { type: 'string' }, version: officeVersionParameter },
      },
    },
    {
      name: 'createOfficeDocument',
      description:
        'Create a NEW local xlsx (sheets with literal values), docx (paragraphs with text and optional heading), or pptx (slides with title/body). Pinned offline engines; docx max1000 paragraphs, pptx max100 slides. XLSX maximum 100000 cells, 20 sheets, 20000 rows per sheet. Existing destination is never overwritten. Text-only docx/pptx creation; no arbitrary template fidelity, images, formula calculation or visual validation.',
      humanIntervention: {
        dynamic: { default: 'never', policy: 'required', type: 'pathScopeAudit' },
      },
      parameters: {
        type: 'object',
        required: ['path'],
        properties: {
          path: { type: 'string' },
          paragraphs: {
            type: 'array',
            items: {
              type: 'object',
              required: ['text'],
              properties: { text: { type: 'string' }, heading: { type: 'boolean' } },
            },
          },
          slides: {
            type: 'array',
            items: {
              type: 'object',
              required: ['title', 'body'],
              properties: { title: { type: 'string' }, body: { type: 'string' } },
            },
          },
          sheets: {
            type: 'array',
            items: {
              type: 'object',
              required: ['name', 'rows'],
              properties: {
                name: { type: 'string' },
                rows: { type: 'array', items: { type: 'array', items: {} } },
              },
            },
          },
        },
      },
    },
    ...(['inspectOfficeDocument', 'readOfficeDocument'] as const).map((name) => ({
      name,
      defaultTimeoutMs: 120_000,
      description:
        name === 'inspectOfficeDocument'
          ? 'Inspect local xlsx/docx/pptx structure with bounded samples and a resource version. Excel lists worksheet names. Use readOfficeDocument for selected content or Excel numeric/grouped summaries; no external parser is needed.'
          : 'Read bounded local Office rows, paragraphs or slides in actual document order. Returns actualRange, total (or unknown), hasMore and next parameters. Excel returns cached values and formulas without recalculation. For Excel totals or grouped summaries, prefer aggregateColumn (numeric column letter) with optional groupByColumn: scans from start to worksheet end for count/sum/min/max without injecting rows or writing a parser.',
      humanIntervention: {
        dynamic: {
          default: 'never' as const,
          policy: 'required' as const,
          type: 'pathScopeAudit' as const,
        },
      },
      parameters: {
        type: 'object' as const,
        required: ['path'],
        properties: {
          path: { type: 'string' as const },
          sheet: { type: 'string' as const },
          start: {
            type: 'number' as const,
            description: 'One-based row, paragraph or slide, defaults to 1',
          },
          limit: { type: 'number' as const, description: 'Maximum records, capped at 500' },
          maxChars: {
            type: 'number' as const,
            description: 'JSON record character budget, capped at 64000',
          },
          version: officeVersionParameter,
          groupByColumn: {
            type: 'string' as const,
            description:
              'Optional Excel column letter to group numeric aggregate results by; max500 groups',
          },
          aggregateColumn: {
            type: 'string' as const,
            description:
              'Excel numeric column letter to aggregate from start to sheet end; ignores row limit, returns summaries instead of rows',
          },
        },
      },
    })),
    {
      defaultTimeoutMs: 30_000,
      description:
        'Read the content of a text or document file (txt/md/json/source code/pdf/docx/etc.). Binary files (.bin/.exe/.zip/.b64/encoded blobs) are rejected with a structured error — use runCommand with file/hexdump/strings to inspect those instead. Output is capped at 500K chars total and 8K chars per line; for larger files, use a narrower line range or grepContent.',
      humanIntervention: {
        dynamic: {
          default: 'never',
          policy: 'required',
          type: 'pathScopeAudit',
        },
      },
      name: LocalSystemApiName.readFile,
      parameters: {
        properties: {
          loc: {
            description:
              'Optional range of lines to read [startLine, endLine]. Defaults to [0, 200] if not specified.',
            items: {
              type: 'number',
            },
            type: 'array',
          },
          path: {
            description: 'The file path to read',
            type: 'string',
          },
        },
        required: ['path'],
        type: 'object',
      },
    },
    {
      defaultTimeoutMs: 60_000,
      description:
        'Search for files within the workspace based on a query string and optional filter options. Input should include the search query and any filter options. Output is a JSON array of matching file paths.',
      humanIntervention: {
        dynamic: {
          default: 'never',
          policy: 'required',
          type: 'pathScopeAudit',
        },
      },
      name: LocalSystemApiName.searchFiles,
      parameters: {
        properties: {
          contentContains: {
            description: 'The file content must contain this string',
            type: 'string',
          },
          createdAfter: {
            description:
              'Files created after this date (ISO 8601 format, e.g., 2023-10-26T10:00:00Z)',
            format: 'date-time',
            type: 'string',
          },
          createdBefore: {
            description: 'Files created before this date (ISO 8601 format)',
            format: 'date-time',
            type: 'string',
          },
          exclude: {
            description: 'Array of file or directory paths to exclude',
            items: {
              type: 'string',
            },
            type: 'array',
          },
          fileTypes: {
            description: 'Array of file types to include (e.g., "public.image", "txt")',
            items: {
              type: 'string',
            },
            type: 'array',
          },
          keywords: {
            description: 'The search keywords string (can include partial names or keywords)',
            type: 'string',
          },
          scope: {
            description:
              'Optional sub-scope within an authorized execution workspace. The runtime supplies the workspace when omitted.',
            type: 'string',
          },
          limit: {
            description: 'Limit the number of results returned',
            type: 'number',
          },
          liveUpdate: {
            description: 'Whether to update search results live (if supported)',
            type: 'boolean',
          },
          modifiedAfter: {
            description: 'Files modified after this date (ISO 8601 format)',
            format: 'date-time',
            type: 'string',
          },
          modifiedBefore: {
            description: 'Files modified before this date (ISO 8601 format)',
            format: 'date-time',
            type: 'string',
          },
          sortBy: {
            description: 'Sort results by',
            enum: ['name', 'date', 'size'],
            type: 'string',
          },
          sortDirection: {
            description: 'Sort direction',
            enum: ['asc', 'desc'],
            type: 'string',
          },
        },
        required: ['keywords'],
        type: 'object',
      },
    },
    {
      defaultTimeoutMs: 60_000,
      description:
        'Moves or renames multiple files/directories. Input is an array of objects, each containing an oldPath and a newPath.',
      humanIntervention: {
        dynamic: {
          default: 'never',
          policy: 'required',
          type: 'pathScopeAudit',
        },
      },
      name: LocalSystemApiName.moveFiles,
      parameters: {
        properties: {
          items: {
            description: 'A list of move/rename operations to perform.',
            items: {
              properties: {
                newPath: {
                  description:
                    'The target absolute path for the file/directory (can include a new name).',
                  type: 'string',
                },
                oldPath: {
                  description: 'The current absolute path of the file/directory to move or rename.',
                  type: 'string',
                },
              },
              required: ['oldPath', 'newPath'],
              type: 'object',
            },
            type: 'array',
          },
        },
        required: ['items'],
        type: 'object',
      },
    },
    {
      defaultTimeoutMs: 30_000,
      description:
        'Write content to a specific file. Input should be the file path and content. Overwrites existing file or creates a new one.',
      humanIntervention: {
        dynamic: {
          default: 'never',
          policy: 'required',
          type: 'pathScopeAudit',
        },
      },
      name: LocalSystemApiName.writeFile,
      parameters: {
        properties: {
          content: {
            description: 'The content to write',
            type: 'string',
          },
          path: {
            description: 'The file path to write to',
            type: 'string',
          },
        },
        required: ['path', 'content'],
        type: 'object',
      },
    },
    {
      defaultTimeoutMs: 30_000,
      description:
        'Perform exact string replacements in files. Must read the file first before editing.',
      humanIntervention: {
        dynamic: {
          default: 'never',
          policy: 'required',
          type: 'pathScopeAudit',
        },
      },
      name: LocalSystemApiName.editFile,
      parameters: {
        properties: {
          file_path: {
            description: 'The absolute path to the file to modify',
            type: 'string',
          },
          new_string: {
            description: 'The text to replace with (must differ from old_string)',
            type: 'string',
          },
          old_string: {
            description: 'The exact text to replace',
            type: 'string',
          },
          replace_all: {
            description: 'Replace all occurrences of old_string (default: false)',
            type: 'boolean',
          },
        },
        required: ['file_path', 'old_string', 'new_string'],
        type: 'object',
      },
    },
    {
      defaultTimeoutMs: 30_000,
      description:
        'Start a terminal session to execute a shell command and return console output collected during the wait window (up to 30 seconds by default). If the command is still running after the wait window, the result includes `shell_id` for later observation or termination.',
      humanIntervention: 'required',
      name: LocalSystemApiName.runCommand,
      parameters: {
        properties: {
          command: {
            description: 'The shell command to execute',
            type: 'string',
          },
          description: {
            description:
              'Clear description of what this command does (5-10 words, in active voice). Use the same language as the user input.',
            type: 'string',
          },
          run_in_background: {
            description:
              'Set to true to return immediately after starting the terminal session. The result will include a `shell_id` for later observation or termination.',
            type: 'boolean',
          },
        },
        required: ['description', 'command'],
        type: 'object',
      },
    },
    {
      defaultTimeoutMs: 30_000,
      description:
        'Retrieve output from a running or completed background shell command. Waits for one output window (up to 30 seconds by default) and returns only new output since the last check.',
      name: LocalSystemApiName.getCommandOutput,
      parameters: {
        properties: {
          filter: {
            description:
              'Optional regex pattern to filter output lines. Only matching lines are returned.',
            type: 'string',
          },
          shell_id: {
            description: 'The ID of the background shell to retrieve output from',
            type: 'string',
          },
        },
        required: ['shell_id'],
        type: 'object',
      },
    },
    {
      defaultTimeoutMs: 10_000,
      description: 'Kill a running background shell command by its ID.',
      name: LocalSystemApiName.killCommand,
      parameters: {
        properties: {
          shell_id: {
            description: 'The ID of the background shell to kill',
            type: 'string',
          },
        },
        required: ['shell_id'],
        type: 'object',
      },
    },
    {
      defaultTimeoutMs: 60_000,
      description:
        'Search for content within files using regex patterns. Supports various output modes and filtering options.',
      humanIntervention: {
        dynamic: {
          default: 'never',
          policy: 'required',
          type: 'pathScopeAudit',
        },
      },
      name: LocalSystemApiName.grepContent,
      parameters: {
        properties: {
          '-A': {
            description:
              'Number of lines to show after each match (requires output_mode: "content")',
            type: 'number',
          },
          '-B': {
            description:
              'Number of lines to show before each match (requires output_mode: "content")',
            type: 'number',
          },
          '-C': {
            description:
              'Number of lines to show before and after each match (requires output_mode: "content")',
            type: 'number',
          },
          '-i': {
            description: 'Case insensitive search',
            type: 'boolean',
          },
          '-n': {
            description: 'Show line numbers in output (requires output_mode: "content")',
            type: 'boolean',
          },
          'glob': {
            description: 'Glob pattern to filter files (e.g. "*.js", "*.{ts,tsx}")',
            type: 'string',
          },
          'head_limit': {
            description: 'Limit output to first N results',
            type: 'number',
          },
          'multiline': {
            description: 'Enable multiline mode where . matches newlines',
            type: 'boolean',
          },
          'output_mode': {
            description:
              'Output mode: "content" (matching lines), "files_with_matches" (file paths), "count" (match counts)',
            enum: ['content', 'files_with_matches', 'count'],
            type: 'string',
          },
          'pattern': {
            description: 'The regular expression pattern to search for',
            type: 'string',
          },
          'scope': {
            description:
              'Optional sub-scope within an authorized execution workspace. The runtime supplies the workspace when omitted.',
            type: 'string',
          },
          'type': {
            description: 'File type to search (e.g. "js", "py", "rust")',
            type: 'string',
          },
        },
        required: ['pattern'],
        type: 'object',
      },
    },
    {
      defaultTimeoutMs: 60_000,
      description:
        'Find files matching glob patterns. Supports standard glob syntax like "**/*.js" or "src/**/*.ts".',
      humanIntervention: {
        dynamic: {
          default: 'never',
          policy: 'required',
          type: 'pathScopeAudit',
        },
      },
      name: LocalSystemApiName.globFiles,
      parameters: {
        properties: {
          pattern: {
            description:
              'The glob pattern to match files against (e.g. "**/*.js", "src/**/*.ts"). Relative patterns are resolved against the scope.',
            type: 'string',
          },
          scope: {
            description:
              'Optional sub-scope within an authorized execution workspace. Relative patterns use the runtime workspace when omitted.',
            type: 'string',
          },
        },
        required: ['pattern'],
        type: 'object',
      },
    },
  ],
  identifier: LocalSystemIdentifier,
  meta: {
    avatar: '📁',
    description: 'Access and manage local files, run shell commands on your desktop',
    readme:
      'Access your local filesystem on desktop. Read, write, search, and organize files. Execute shell commands with background task support and grep content with regex patterns.',
    title: 'Local System',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
