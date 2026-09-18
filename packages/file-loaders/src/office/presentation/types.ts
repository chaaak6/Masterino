export interface PresentationFrame {
  h: number;
  w: number;
  x: number;
  y: number;
}

export interface PresentationTheme {
  colors: {
    accent: string;
    background: string;
    muted: string;
    primary: string;
    text: string;
  };
  fonts: { body: string; heading: string };
}

interface PresentationElementBase {
  frame: PresentationFrame;
  id: string;
}

export interface PresentationTextElement extends PresentationElementBase {
  style?: {
    bold?: boolean;
    color?: string;
    fontFace?: string;
    fontSize?: number;
    italic?: boolean;
  };
  text: string;
  type: 'text';
}

export interface PresentationShapeElement extends PresentationElementBase {
  shape: 'ellipse' | 'line' | 'rect' | 'roundRect';
  style?: { fill?: string; line?: string; lineWidth?: number; transparency?: number };
  type: 'shape';
}

export interface PresentationImageElement extends PresentationElementBase {
  source: { path: string };
  type: 'image';
}

export interface PresentationTableElement extends PresentationElementBase {
  rows: string[][];
  style?: {
    border?: string;
    headerFill?: string;
    headerText?: string;
    text?: string;
  };
  type: 'table';
}

export interface PresentationChartElement extends PresentationElementBase {
  categories: string[];
  chartType: 'bar' | 'doughnut' | 'line' | 'pie';
  series: Array<{ name: string; values: number[] }>;
  style?: { showLegend?: boolean; showTitle?: boolean; title?: string };
  type: 'chart';
}

export type PresentationElement =
  | PresentationChartElement
  | PresentationImageElement
  | PresentationShapeElement
  | PresentationTableElement
  | PresentationTextElement;

export interface PresentationSpec {
  metadata?: { author?: string; subject?: string; title?: string };
  page?: { layout?: 'standard' | 'wide' };
  slides: Array<{
    background?: string;
    elements: PresentationElement[];
    id: string;
    notes?: string;
  }>;
  theme: PresentationTheme;
}

export interface PresentationIssue {
  code: string;
  elementId?: string;
  message: string;
  severity: 'error' | 'warning';
  slideId?: string;
}

export interface PresentationProject {
  artifact: { sha256: string };
  deck: PresentationSpec;
  id: string;
  revision: number;
  schemaVersion: 1;
}

export interface CreatePresentationParams {
  deck: PresentationSpec;
  path: string;
}

export type PresentationOperation =
  | { op: 'addSlide'; slide: PresentationSpec['slides'][number] }
  | { op: 'removeSlide'; slideId: string }
  | { elementId: string; op: 'removeElement'; slideId: string }
  | {
      element: PresentationElement;
      op: 'addElement';
      slideId: string;
    }
  | {
      elementId: string;
      op: 'updateElement';
      patch: Partial<PresentationElement>;
      slideId: string;
    };

export interface RevisePresentationParams {
  expectedRevision: number;
  operations: PresentationOperation[];
  outputPath: string;
  projectPath: string;
}

export interface PresentationResult {
  format: 'pptx';
  path: string;
  presentationId: string;
  projectPath: string;
  revision: number;
  slides: number;
  validation: { errors: number; issues: PresentationIssue[]; warnings: number };
  version: string;
}

export interface ValidatePresentationParams {
  path: string;
  projectPath: string;
}

export interface PresentationValidationResult {
  errors: number;
  features: { charts: number; images: number; notes: number; shapes: number; tables: number };
  issues: PresentationIssue[];
  slides: number;
  valid: boolean;
  warnings: number;
}

export interface RenderPresentationPreviewParams {
  projectPath: string;
  slideIds?: string[];
}

export interface InspectPresentationParams {
  detail: 'elements' | 'issues' | 'outline';
  projectPath: string;
  slideIds?: string[];
}
