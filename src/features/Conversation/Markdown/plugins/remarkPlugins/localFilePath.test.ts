import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { describe, expect, it } from 'vitest';

import { createRemarkSelfClosingTagPlugin } from './createRemarkSelfClosingTagPlugin';

function properties(markdown: string) {
  const processor = unified().use(remarkParse).use(createRemarkSelfClosingTagPlugin('localFile'));
  const tree = processor.runSync(processor.parse(markdown), markdown);
  const nodes: any[] = [];
  function walk(node: any) {
    if (node.type === 'localFile') nodes.push(node.data.hProperties);
    node.children?.forEach(walk);
  }
  walk(tree);
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
