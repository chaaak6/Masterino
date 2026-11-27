import type { MarkdownProps } from '@lobehub/ui';
import GithubSlugger from 'github-slugger';
import type { Element, ElementContent, Root } from 'hast';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { visit } from 'unist-util-visit';

const schema: NonNullable<Parameters<typeof rehypeSanitize>[0]> = {
  ...defaultSchema,
  ancestors: { ...defaultSchema.ancestors, input: ['li'] },
  attributes: {
    ...defaultSchema.attributes,
    details: ['open'],
    img: [...(defaultSchema.attributes?.img ?? []), 'width', 'height'],
    video: ['src', 'poster', 'controls', 'height', 'width', 'muted', 'loop'],
  },
  tagNames: [...(defaultSchema.tagNames ?? []), 'details', 'summary', 'video'],
};

const alertMarker = /^(\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\])[\t ]+(?=\S)/;

// The built-in alert renderer expects a marker followed by a newline.
const normalizeAlert = (quote: Element) => {
  const paragraph = quote.children.find(
    (child): child is Element => child.type === 'element' && child.tagName === 'p',
  );
  const first = paragraph?.children[0];
  if (first?.type === 'text') {
    first.value = first.value.replace(alertMarker, '$1\n');
  }
};

const headingText = (children: ElementContent[]): string =>
  children
    .map((child) => {
      if (child.type === 'text') return child.value;
      if (child.type !== 'element') return '';
      if (child.tagName === 'img') return String(child.properties.alt ?? '');
      return headingText(child.children);
    })
    .join('');

const prepareDocument = () => (tree: Root) => {
  const slugger = new GithubSlugger();
  visit(tree, 'element', (node) => {
    if (node.tagName === 'blockquote') normalizeAlert(node);
    if (/^h[1-6]$/.test(node.tagName) && node.properties.dataFootnoteLabel === undefined) {
      node.properties.dataWorkspaceHeading = slugger.slug(headingText(node.children));
    }
  });
};

// Run before the UI library's alert and KaTeX plugins, which generate their own markup.
export const workspaceMarkdownPlugins = [
  rehypeRaw,
  [rehypeSanitize, schema],
  prepareDocument,
] satisfies NonNullable<MarkdownProps['rehypePluginsAhead']>;
