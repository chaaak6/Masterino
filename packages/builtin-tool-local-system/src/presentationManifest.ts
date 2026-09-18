import type { BuiltinToolManifest } from '@lobechat/types';

const audit = {
  dynamic: {
    default: 'never' as const,
    policy: 'required' as const,
    type: 'pathScopeAudit' as const,
  },
};

const frame = {
  type: 'object' as const,
  required: ['x', 'y', 'w', 'h'],
  properties: {
    h: { exclusiveMinimum: 0, type: 'number' as const },
    w: { exclusiveMinimum: 0, type: 'number' as const },
    x: { minimum: 0, type: 'number' as const },
    y: { minimum: 0, type: 'number' as const },
  },
};

const element = {
  type: 'object' as const,
  required: ['id', 'type', 'frame'],
  properties: {
    id: { maxLength: 100, minLength: 1, type: 'string' as const },
    type: {
      enum: ['text', 'image', 'shape', 'table', 'chart'],
      type: 'string' as const,
    },
    frame,
    text: { maxLength: 10_000, type: 'string' as const },
    shape: { enum: ['ellipse', 'line', 'rect', 'roundRect'], type: 'string' as const },
    source: {
      type: 'object' as const,
      required: ['path'],
      properties: { path: { type: 'string' as const } },
    },
    rows: {
      type: 'array' as const,
      maxItems: 100,
      items: {
        type: 'array' as const,
        maxItems: 20,
        items: { type: 'string' as const },
      },
    },
    chartType: { enum: ['bar', 'doughnut', 'line', 'pie'], type: 'string' as const },
    categories: {
      type: 'array' as const,
      maxItems: 100,
      items: { type: 'string' as const },
    },
    series: {
      type: 'array' as const,
      maxItems: 20,
      items: {
        type: 'object' as const,
        required: ['name', 'values'],
        properties: {
          name: { type: 'string' as const },
          values: { type: 'array' as const, items: { type: 'number' as const }, maxItems: 100 },
        },
      },
    },
    style: { additionalProperties: true, type: 'object' as const },
  },
};

const slide = {
  type: 'object' as const,
  required: ['id', 'elements'],
  properties: {
    id: { maxLength: 100, minLength: 1, type: 'string' as const },
    background: { description: 'Six-digit hex color without #', type: 'string' as const },
    elements: { items: element, maxItems: 200, type: 'array' as const },
    notes: { maxLength: 20_000, type: 'string' as const },
  },
};

const deck = {
  type: 'object' as const,
  required: ['slides', 'theme'],
  properties: {
    metadata: {
      type: 'object' as const,
      properties: {
        author: { type: 'string' as const },
        subject: { type: 'string' as const },
        title: { type: 'string' as const },
      },
    },
    page: {
      type: 'object' as const,
      properties: { layout: { enum: ['wide', 'standard'], type: 'string' as const } },
    },
    slides: { items: slide, maxItems: 100, minItems: 1, type: 'array' as const },
    theme: {
      type: 'object' as const,
      required: ['colors', 'fonts'],
      properties: {
        colors: {
          type: 'object' as const,
          required: ['primary', 'accent', 'text', 'muted', 'background'],
          properties: Object.fromEntries(
            ['primary', 'accent', 'text', 'muted', 'background'].map((name) => [
              name,
              { description: 'Six-digit hex color without #', type: 'string' },
            ]),
          ),
        },
        fonts: {
          type: 'object' as const,
          required: ['heading', 'body'],
          properties: {
            body: { type: 'string' as const },
            heading: { type: 'string' as const },
          },
        },
      },
    },
  },
};

export const PRESENTATION_API_NAMES = [
  'createPresentation',
  'revisePresentation',
  'inspectPresentation',
  'renderPresentationPreview',
  'validatePresentation',
] as const;

export const PRESENTATION_API_VERSIONS = Object.fromEntries(
  PRESENTATION_API_NAMES.map((name) => [name, 1]),
) as Record<(typeof PRESENTATION_API_NAMES)[number], number>;

export const presentationApis: BuiltinToolManifest['api'] = [
  {
    defaultTimeoutMs: 180_000,
    description:
      'Create a new rich local PowerPoint from a deterministic deck specification. Supports native text, local images, shapes, tables, bar/line/pie/doughnut charts and speaker notes. Also creates a Masterino project sidecar for safe revisions. Existing files are never overwritten.',
    humanIntervention: audit,
    name: 'createPresentation',
    parameters: {
      type: 'object',
      required: ['path', 'deck'],
      properties: { path: { type: 'string' }, deck },
    },
  },
  {
    defaultTimeoutMs: 180_000,
    description:
      'Revise a presentation previously created by createPresentation using stable slide and element ids. Writes a new PPTX output and atomically advances the existing project revision. Never use for arbitrary imported PPTX files.',
    humanIntervention: audit,
    name: 'revisePresentation',
    parameters: {
      type: 'object',
      required: ['projectPath', 'outputPath', 'expectedRevision', 'operations'],
      properties: {
        projectPath: { type: 'string' },
        outputPath: { type: 'string' },
        expectedRevision: { minimum: 1, type: 'number' },
        operations: {
          type: 'array',
          maxItems: 500,
          items: {
            type: 'object',
            required: ['op'],
            properties: {
              op: {
                enum: ['addSlide', 'removeSlide', 'addElement', 'updateElement', 'removeElement'],
                type: 'string',
              },
              slideId: { type: 'string' },
              elementId: { type: 'string' },
              slide,
              element,
              patch: { additionalProperties: true, type: 'object' },
            },
          },
        },
      },
    },
  },
  {
    defaultTimeoutMs: 120_000,
    description:
      'Inspect a Masterino presentation project as a bounded outline, selected element details, or validation issues. Select at most 20 slides and 500 elements.',
    humanIntervention: audit,
    name: 'inspectPresentation',
    parameters: {
      type: 'object',
      required: ['projectPath', 'detail'],
      properties: {
        projectPath: { type: 'string' },
        detail: { enum: ['outline', 'elements', 'issues'], type: 'string' },
        slideIds: { items: { type: 'string' }, maxItems: 20, type: 'array' },
      },
    },
  },
  {
    defaultTimeoutMs: 180_000,
    description:
      'Render deterministic local SVG previews from a Masterino presentation project. The previews validate Masterino layout geometry; they are not screenshots from PowerPoint or WPS.',
    humanIntervention: audit,
    name: 'renderPresentationPreview',
    parameters: {
      type: 'object',
      required: ['projectPath'],
      properties: {
        projectPath: { type: 'string' },
        slideIds: { items: { type: 'string' }, maxItems: 20, type: 'array' },
      },
    },
  },
  {
    defaultTimeoutMs: 180_000,
    description:
      'Validate a generated local PPTX against its Masterino project. Checks the deck schema, supported features and PPTX package slide count before delivery.',
    humanIntervention: audit,
    name: 'validatePresentation',
    parameters: {
      type: 'object',
      required: ['path', 'projectPath'],
      properties: { path: { type: 'string' }, projectPath: { type: 'string' } },
    },
  },
];
