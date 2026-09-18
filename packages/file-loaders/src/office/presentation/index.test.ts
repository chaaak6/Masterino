// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, expect, it } from 'vitest';

import { readOfficeDocument } from '../index';
import {
  createPresentation,
  inspectPresentation,
  renderPresentationPreview,
  revisePresentation,
  validatePresentation,
} from './index';

const dirs: string[] = [];

const fixture = async (name: string) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'presentation-test-'));
  dirs.push(dir);
  return path.join(dir, name);
};

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

it('creates a themed presentation and a local project that can be revised later', async () => {
  const outputPath = await fixture('quarterly-review.pptx');

  const created = await createPresentation({
    path: outputPath,
    deck: {
      metadata: { author: 'Masterino', title: 'Quarterly Review' },
      page: { layout: 'wide' },
      slides: [
        {
          id: 'overview',
          elements: [
            {
              id: 'title',
              type: 'text',
              frame: { h: 0.7, w: 11.8, x: 0.75, y: 0.55 },
              text: 'Quarterly Review',
              style: { bold: true, color: '17324D', fontSize: 28 },
            },
            {
              id: 'accent',
              type: 'shape',
              frame: { h: 0.08, w: 2.1, x: 0.75, y: 1.42 },
              shape: 'rect',
              style: { fill: '2F80ED', line: '2F80ED' },
            },
          ],
        },
      ],
      theme: {
        colors: {
          accent: '2F80ED',
          background: 'FFFFFF',
          muted: '667085',
          primary: '17324D',
          text: '101828',
        },
        fonts: { body: 'Arial', heading: 'Arial' },
      },
    },
  });

  expect(created).toMatchObject({
    format: 'pptx',
    path: outputPath,
    revision: 1,
    slides: 1,
    validation: { errors: 0 },
  });
  expect(created.projectPath).toBe(`${outputPath}.masterino.json`);
  expect(JSON.parse(await readFile(created.projectPath, 'utf8'))).toMatchObject({ revision: 1 });
  expect(
    (await readOfficeDocument({ path: outputPath })).records.map((record) => record.text),
  ).toEqual(['Quarterly Review']);
});

it('creates native image, table and chart content and renders deterministic local previews', async () => {
  const outputPath = await fixture('rich-deck.pptx');
  const imagePath = path.join(path.dirname(outputPath), 'pixel.png');
  await import('node:fs/promises').then(({ writeFile }) =>
    writeFile(
      imagePath,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZC9sAAAAASUVORK5CYII=',
        'base64',
      ),
    ),
  );
  const created = await createPresentation({
    path: outputPath,
    deck: {
      slides: [
        {
          id: 'performance',
          notes: 'Explain the revenue trend before discussing costs.',
          elements: [
            {
              id: 'logo',
              type: 'image',
              frame: { h: 0.5, w: 0.5, x: 12, y: 0.4 },
              source: { path: imagePath },
            },
            {
              id: 'data',
              type: 'table',
              frame: { h: 2.1, w: 4.6, x: 0.7, y: 1.3 },
              rows: [
                ['Quarter', 'Revenue'],
                ['Q1', '100'],
                ['Q2', '120'],
              ],
              style: { headerFill: '17324D', headerText: 'FFFFFF' },
            },
            {
              categories: ['Q1', 'Q2'],
              id: 'trend',
              type: 'chart',
              chartType: 'bar',
              frame: { h: 3.5, w: 6.3, x: 6.1, y: 1.3 },
              series: [{ name: 'Revenue', values: [100, 120] }],
              style: { showLegend: false, showTitle: true, title: 'Revenue trend' },
            },
          ],
        },
        { id: 'no-notes', elements: [] },
      ],
      theme: {
        colors: {
          accent: '2F80ED',
          background: 'FFFFFF',
          muted: '667085',
          primary: '17324D',
          text: '101828',
        },
        fonts: { body: 'Arial', heading: 'Arial' },
      },
    },
  });

  const validation = await validatePresentation({
    path: outputPath,
    projectPath: created.projectPath,
  });
  expect(validation).toMatchObject({ errors: 0, slides: 2, valid: true });
  expect(validation.features).toEqual(
    expect.objectContaining({ charts: 1, images: 1, notes: 1, tables: 1 }),
  );

  const preview = await renderPresentationPreview({ projectPath: created.projectPath });
  expect(preview.slides).toHaveLength(2);
  expect(await readFile(preview.slides[0]!.path, 'utf8')).toContain('Revenue trend');
});

it('revises a generated project by stable ids and rejects stale or invalid changes', async () => {
  const outputPath = await fixture('draft.pptx');
  const created = await createPresentation({
    path: outputPath,
    deck: {
      slides: [
        {
          id: 'summary',
          elements: [
            {
              id: 'headline',
              type: 'text',
              frame: { h: 0.8, w: 10, x: 0.8, y: 0.5 },
              text: 'Draft headline',
            },
          ],
        },
      ],
      theme: {
        colors: {
          accent: '2F80ED',
          background: 'FFFFFF',
          muted: '667085',
          primary: '17324D',
          text: '101828',
        },
        fonts: { body: 'Arial', heading: 'Arial' },
      },
    },
  });
  const revisedPath = path.join(path.dirname(outputPath), 'final.pptx');
  const revised = await revisePresentation({
    expectedRevision: 1,
    operations: [
      {
        elementId: 'headline',
        op: 'updateElement',
        patch: { text: 'Final headline' },
        slideId: 'summary',
      },
      {
        op: 'addSlide',
        slide: {
          id: 'closing',
          elements: [
            {
              id: 'thanks',
              type: 'text',
              frame: { h: 1, w: 8, x: 2.6, y: 3 },
              text: 'Thank you',
            },
          ],
        },
      },
    ],
    outputPath: revisedPath,
    projectPath: created.projectPath,
  });
  expect(revised).toMatchObject({ path: revisedPath, revision: 2, slides: 2 });
  expect(
    (await readOfficeDocument({ path: revisedPath })).records.map((record) => record.text),
  ).toEqual(['Final headline', 'Thank you']);
  await expect(
    inspectPresentation({ detail: 'outline', projectPath: created.projectPath }),
  ).resolves.toMatchObject({
    revision: 2,
    slides: [
      { elementCount: 1, id: 'summary' },
      { elementCount: 1, id: 'closing' },
    ],
  });

  const stalePath = path.join(path.dirname(outputPath), 'stale.pptx');
  await expect(
    revisePresentation({
      expectedRevision: 1,
      operations: [],
      outputPath: stalePath,
      projectPath: created.projectPath,
    }),
  ).rejects.toThrow('PRESENTATION_REVISION_CHANGED');
  await expect(readFile(stalePath)).rejects.toThrow();

  const invalidPath = path.join(path.dirname(outputPath), 'invalid.pptx');
  await expect(
    revisePresentation({
      expectedRevision: 2,
      operations: [
        {
          elementId: 'headline',
          op: 'updateElement',
          patch: { frame: { h: 2, w: 5, x: 12, y: 7 } },
          slideId: 'summary',
        },
      ],
      outputPath: invalidPath,
      projectPath: created.projectPath,
    }),
  ).rejects.toThrow('INVALID_PRESENTATION');
  await expect(readFile(invalidPath)).rejects.toThrow();
});

it('allows only one concurrent revision for the same expected revision', async () => {
  const outputPath = await fixture('concurrent.pptx');
  const created = await createPresentation({
    path: outputPath,
    deck: {
      slides: [
        {
          id: 'only',
          elements: [
            { id: 'title', type: 'text', frame: { h: 1, w: 8, x: 1, y: 1 }, text: 'Original' },
          ],
        },
      ],
      theme: {
        colors: {
          accent: '2F80ED',
          background: 'FFFFFF',
          muted: '667085',
          primary: '17324D',
          text: '101828',
        },
        fonts: { body: 'Arial', heading: 'Arial' },
      },
    },
  });
  const results = await Promise.allSettled([
    revisePresentation({
      expectedRevision: 1,
      operations: [],
      outputPath: path.join(path.dirname(outputPath), 'a.pptx'),
      projectPath: created.projectPath,
    }),
    revisePresentation({
      expectedRevision: 1,
      operations: [],
      outputPath: path.join(path.dirname(outputPath), 'b.pptx'),
      projectPath: created.projectPath,
    }),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  await expect(
    inspectPresentation({ detail: 'outline', projectPath: created.projectPath }),
  ).resolves.toMatchObject({ revision: 2 });
});

it('rejects malformed elements without throwing an implementation TypeError', async () => {
  const outputPath = await fixture('malformed.pptx');
  await expect(
    createPresentation({
      path: outputPath,
      deck: {
        slides: [
          {
            id: 'bad',
            elements: [{ id: 'table', type: 'table', frame: { h: 1, w: 1, x: 0, y: 0 } } as never],
          },
        ],
        theme: {
          colors: {
            accent: '2F80ED',
            background: 'FFFFFF',
            muted: '667085',
            primary: '17324D',
            text: '101828',
          },
          fonts: { body: 'Arial', heading: 'Arial' },
        },
      },
    }),
  ).rejects.toThrow('INVALID_PRESENTATION');
});

it('detects a PPTX that no longer matches its project even when slide count is unchanged', async () => {
  const firstPath = await fixture('first.pptx');
  const first = await createPresentation({
    path: firstPath,
    deck: {
      slides: [
        {
          id: 'first',
          elements: [{ id: 'one', type: 'text', frame: { h: 1, w: 8, x: 1, y: 1 }, text: 'First' }],
        },
      ],
      theme: {
        colors: {
          accent: '2F80ED',
          background: 'FFFFFF',
          muted: '667085',
          primary: '17324D',
          text: '101828',
        },
        fonts: { body: 'Arial', heading: 'Arial' },
      },
    },
  });
  const secondPath = path.join(path.dirname(firstPath), 'second.pptx');
  await createPresentation({
    path: secondPath,
    deck: {
      slides: [
        {
          id: 'second',
          elements: [
            { id: 'two', type: 'text', frame: { h: 1, w: 8, x: 1, y: 1 }, text: 'Second' },
          ],
        },
      ],
      theme: {
        colors: {
          accent: '2F80ED',
          background: 'FFFFFF',
          muted: '667085',
          primary: '17324D',
          text: '101828',
        },
        fonts: { body: 'Arial', heading: 'Arial' },
      },
    },
  });
  await writeFile(firstPath, await readFile(secondPath));
  await expect(
    validatePresentation({ path: firstPath, projectPath: first.projectPath }),
  ).resolves.toMatchObject({ valid: false });
});

it('keeps preview filenames inside the audited preview directory for hostile slide ids', async () => {
  const outputPath = await fixture('safe-preview.pptx');
  const created = await createPresentation({
    path: outputPath,
    deck: {
      slides: [
        {
          id: '../../../../escape',
          elements: [
            { id: 'title', type: 'text', frame: { h: 1, w: 8, x: 1, y: 1 }, text: 'Safe' },
          ],
        },
      ],
      theme: {
        colors: {
          accent: '2F80ED',
          background: 'FFFFFF',
          muted: '667085',
          primary: '17324D',
          text: '101828',
        },
        fonts: { body: 'Arial', heading: 'Arial' },
      },
    },
  });
  const preview = await renderPresentationPreview({ projectPath: created.projectPath });
  expect(path.dirname(preview.slides[0]!.path)).toBe(`${created.projectPath}.previews/r1`);
  expect(path.basename(preview.slides[0]!.path)).toBe('slide-1.svg');
});
