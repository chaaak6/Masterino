import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { describe, expect, it } from 'vitest';

import { createRemarkSelfClosingTagPlugin } from './createRemarkSelfClosingTagPlugin';

function parse(markdown: string) {
  const processor = unified().use(remarkParse).use(createRemarkSelfClosingTagPlugin('localFile'));
  return processor.runSync(processor.parse(markdown), markdown);
}

function allProperties(markdown: string) {
  const tree = parse(markdown);
  const nodes: any[] = [];
  function walk(node: any) {
    if (node.type === 'localFile') nodes.push(node.data.hProperties);
    node.children?.forEach(walk);
  }
  walk(tree);
  return nodes;
}

function properties(markdown: string) {
  const nodes = allProperties(markdown);
  expect(nodes).toHaveLength(1);
  return nodes[0];
}

const paths = [
  '/Users/bielnb756/Library/Application Support/Masterino/品牌之路-合并版.pptx',
  '/Users/bielnb756/Desktop/品牌之路-合并版.pptx',
  String.raw`C:\Users\李惠婷\Desktop\年度 报告.pptx`,
  'D:/项目 文档/品牌之路.pptx',
  String.raw`\\?\C:\Users\李惠婷\Long Path\报告.pptx`,
  String.raw`\\?\UNC\server\共享 文件\报告.pptx`,
  String.raw`\\server\共享 文件\报告.pptx`,
  '/Volumes/项目 磁盘/报告.pptx',
  '/tmp/emoji 📁/cafe\u0301 报告\u00A0最终.pptx',
  '/tmp/a < b > c &x; %2F.txt',
  "~/Desktop/O'Brien 报告.pptx",
  './附件/日本語 한국어.pptx',
  '/tmp/报告 #1 & 100%20 (最终)=版.pptx',
];

describe('model localFile path recovery through real Markdown', () => {
  for (const [left, right] of [
    ['"', '"'],
    ["'", "'"],
    ['“', '”'],
    ['‘', '’'],
    ['「', '」'],
  ]) {
    it.each(paths)(`preserves ${left}%s${right}`, (path) => {
      expect(properties(`<localFile name="报告.pptx" path=${left}${path}${right} />`).path).toBe(
        path,
      );
    });
  }
  it.each([
    ['“/Users/me/Application Support/report.pptx', '/Users/me/Application Support/report.pptx'],
    ['“/Users/me/a b.pptx"', '/Users/me/a b.pptx'],
    ['”/Users/me/a b.pptx”', '/Users/me/a b.pptx'],
    ['‘/Users/me/a b.pptx’', '/Users/me/a b.pptx'],
    ['"/Users/me/a b.pptx”', '/Users/me/a b.pptx'],
    ['""/Users/me/a b.pptx""', '/Users/me/a b.pptx'],
    ['/Users/me/a b.pptx', '/Users/me/a b.pptx'],
    [String.raw`“C:\Users\me\My Documents\a.pptx`, String.raw`C:\Users\me\My Documents\a.pptx`],
  ])('recovers bounded wrapper %s', (raw, path) => {
    expect(properties(`<localFile name="report" path=${raw} />`).path).toBe(path);
  });
  it('retains path-first and boolean attributes', () => {
    expect(properties('<localFile path=“/Users/me/a b” name=“我的目录” isDirectory />')).toEqual({
      name: '我的目录',
      path: '/Users/me/a b',
      isDirectory: true,
    });
  });
  it('does not split attribute-looking text inside proper quotes or strip literal filename quotes', () => {
    const path = '/Users/me/a name=“报价” and path=x.pptx';
    expect(properties(`<localFile name="report" path='${path}' />`).path).toBe(path);
  });
  it('preserves POSIX backslashes and quoted filename characters', () => {
    const path = String.raw`/tmp/“报价”\part.txt`;
    expect(properties(`<localFile path='${path}' name="test" />`).path).toBe(path);
  });
  it.each(['%s', '结果：%s', '`%s`'])('replays historical messages through %s', (format) => {
    const path =
      '/Users/bielnb756/Library/Application Support/Masterino/lobehub-storage/scratch-workspaces/tpc_J6Y3mouEVdWZ/品牌之路-合并版.pptx';
    const tag = `<localFile name=“品牌之路-合并版.pptx” path=“${path}” />`;
    expect(properties(format.replace('%s', tag))).toMatchObject({
      name: '品牌之路-合并版.pptx',
      path,
    });
  });
  it('does not change other tag attribute parsing', () => {
    const processor = unified().use(remarkParse).use(createRemarkSelfClosingTagPlugin('mention'));
    const result = processor.runSync(processor.parse('<mention id="abc" label="a b" />'));
    expect((result.children[0] as any).data.hProperties).toEqual({ id: 'abc', label: 'a b' });
  });
  it('rejects a missing delimiter that would swallow another quoted attribute', () => {
    expect(properties('<localFile path="/tmp/a b name="report" />').path).toBeUndefined();
  });
  it('never accepts a duplicate path by silently choosing one', () => {
    expect(
      properties('<localFile name="report" path="/tmp/a" path="/tmp/b" />').path,
    ).toBeUndefined();
  });
  it.each(['', 'https://example.com/a', 'javascript:alert(1)', '/tmp/a\u0000b', '/tmp/a\nb'])(
    'rejects invalid path %j',
    (path) => {
      expect(properties(`<localFile name="report" path="${path}" />`).path).toBeUndefined();
    },
  );
});

describe('Crystal Review regressions', () => {
  it('preserves prose and the next file after an unclosed tag', () => {
    const markdown = '<localFile name="a">\n说明\n<localFile name="b" path="/tmp/b" />';
    expect(JSON.stringify(parse(markdown))).toContain('说明');
    expect(allProperties(markdown)).toEqual([{ name: 'b', path: '/tmp/b' }]);
  });

  it.each(['isDirectory', 'isDirectory="true"', 'isDirectory="false"'])(
    'keeps the path separate from %s',
    (attribute) => {
      expect(properties(`<localFile name="a" path="/tmp/a b" ${attribute} />`)).toEqual({
        isDirectory: !attribute.includes('false'),
        name: 'a',
        path: '/tmp/a b',
      });
    },
  );

  it.each(['<localFile/>', '<localFile />'])('keeps adjacent paths after %s', (empty) => {
    const markdown = `${empty}\n<localFile name="a" path="/tmp/a" />\n<localFile name="b" path="/tmp/b" />`;
    expect(allProperties(markdown).map(({ path }) => path)).toEqual([
      undefined,
      '/tmp/a',
      '/tmp/b',
    ]);
  });

  it('does not associate an entity-escaped tag with the next file', () => {
    const markdown =
      '&lt;localFile name=“A” path=“/tmp/A” /&gt; <localFile name=“B” path=“/tmp/B” />';
    expect(allProperties(markdown)).toEqual([{ name: 'B', path: '/tmp/B' }]);
    expect(JSON.stringify(parse(markdown))).toContain('<localFile name=“A”');
  });

  it('keeps a Markdown-escaped opening bracket as prose', () => {
    const markdown = String.raw`\<localFile name=“A” path=“/tmp/A” /> <localFile name=“B” path=“/tmp/B” />`;
    expect(allProperties(markdown)).toEqual([{ name: 'B', path: '/tmp/B' }]);
  });

  it('does not recover a truncated path from an unterminated tag with a quoted terminator', () => {
    expect(allProperties('结果：<localFile name=“a” path=“/tmp/a /> b”')).toEqual([]);
  });

  it.each(['id="1" name="a" path="/tmp/a"', 'name=“a” path=“/tmp/a” size=“1 MB”'])(
    'ignores extra attributes in %s',
    (attributes) => {
      expect(properties(`<localFile ${attributes} />`)).toEqual({ name: 'a', path: '/tmp/a' });
    },
  );

  it.each(['"', '“'])('keeps a terminator inside a %s-quoted path', (open) => {
    const close = open === '“' ? '”' : open;
    expect(properties(`<localFile name="a" path=${open}/tmp/a /> b${close} />`).path).toBe(
      '/tmp/a /> b',
    );
  });

  it('decodes text-node references and POSIX Markdown escapes', () => {
    const markdown = String.raw`结果：<localFile name=“R&amp;D 报告” path=“/tmp/R&amp;D\_最终.pptx” />`;
    expect(properties(markdown)).toEqual({ name: 'R&D 报告', path: '/tmp/R&D_最终.pptx' });
  });

  it('decodes Windows entities without unescaping Windows path separators', () => {
    const markdown = String.raw`结果：<localFile name=“报告” path=“\\?\UNC\server\R&amp;D\_最终.pptx” />`;
    expect(properties(markdown).path).toBe(String.raw`\\?\UNC\server\R&D\_最终.pptx`);
  });
});

describe('review follow-up', () => {
  it.each([String.raw`..\..\Assets\_report.txt`, String.raw`Assets\_report.txt`])(
    'preserves relative Windows path %s',
    (path) => {
      expect(properties(`结果：<localFile name=“报告” path=“${path}” />`).path).toBe(path);
    },
  );

  it('rejects a recovered path that could contain an unknown assignment', () => {
    expect(
      properties('结果：<localFile name="a" path=“/tmp/报表 total=2024/报告.pptx />').path,
    ).toBeUndefined();
  });

  it('accepts directory attributes regardless of casing', () => {
    expect(properties('<localFile name="a" path="/tmp/a b" IsDirectory />')).toEqual({
      isDirectory: true,
      name: 'a',
      path: '/tmp/a b',
    });
  });

  it('preserves literal entities in historical code spans', () => {
    expect(properties('`<localFile name="R&amp;D" path="/tmp/R&amp;D.pptx" />`')).toEqual({
      name: 'R&amp;D',
      path: '/tmp/R&amp;D.pptx',
    });
  });

  it('keeps adjacent file tags separate when the first quote is mismatched', () => {
    const markdown =
      '结果：<localFile name=“A” path=“/tmp/Application Support/A.pptx" /> 和 <localFile name=“B” path=“/tmp/Application Support/B.pptx” />';
    expect(allProperties(markdown)).toEqual([
      { name: 'A', path: '/tmp/Application Support/A.pptx' },
      { name: 'B', path: '/tmp/Application Support/B.pptx' },
    ]);
    expect(JSON.stringify(parse(markdown))).toContain(' 和 ');
  });

  it('keeps tag-like text inside a closed display name', () => {
    expect(properties('<localFile name="示例 <localFile marker>" path="/tmp/a b" />')).toEqual({
      name: '示例 <localFile marker>',
      path: '/tmp/a b',
    });
  });
});
