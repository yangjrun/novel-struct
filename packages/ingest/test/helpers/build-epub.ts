import { strToU8, zipSync } from 'fflate';

/** XHTML documents by path under OEBPS/, in spine order. */
export interface EpubSpec {
  readonly title?: string;
  readonly author?: string;
  readonly docs: Readonly<Record<string, string>>;
  /** EPUB 3 navigation document body (the `<nav>` element and its list). */
  readonly nav?: string;
  /** EPUB 2 NCX navMap content. */
  readonly ncx?: string;
  /** Whether the navigation document is also listed in the spine, as many books do. */
  readonly navInSpine?: boolean;
}

/** Builds a minimal but valid EPUB in memory. */
export function buildEpub(spec: EpubSpec): Uint8Array {
  const docIds = Object.keys(spec.docs).map((path, i) => ({ path, id: `doc${i}` }));
  const manifest = [
    ...docIds.map(({ path, id }) => `<item id="${id}" href="${path}" media-type="application/xhtml+xml"/>`),
    ...(spec.nav === undefined
      ? []
      : ['<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>']),
    ...(spec.ncx === undefined ? [] : ['<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>']),
    '<item id="cover-image" href="cover.jpg" media-type="image/jpeg"/>',
  ].join('\n');
  const spine = [
    ...(spec.navInSpine === true && spec.nav !== undefined ? ['<itemref idref="nav"/>'] : []),
    ...docIds.map(({ id }) => `<itemref idref="${id}"/>`),
    '<itemref idref="doc0" linear="no"/>',
  ].join('\n');
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:demo</dc:identifier>
    ${spec.title === undefined ? '' : `<dc:title>${spec.title}</dc:title>`}
    ${spec.author === undefined ? '' : `<dc:creator>${spec.author}</dc:creator>`}
    <dc:language>zh</dc:language>
  </metadata>
  <manifest>
${manifest}
  </manifest>
  <spine${spec.ncx === undefined ? '' : ' toc="ncx"'}>
${spine}
  </spine>
</package>`;

  const files: Record<string, Uint8Array> = {
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`),
    'OEBPS/content.opf': strToU8(opf),
    'OEBPS/cover.jpg': new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    ...Object.fromEntries(Object.entries(spec.docs).map(([path, body]) => [`OEBPS/${path}`, strToU8(xhtml(body))])),
  };
  if (spec.nav !== undefined)
    files['OEBPS/nav.xhtml'] = strToU8(xhtml(spec.nav, ' xmlns:epub="http://www.idpf.org/2007/ops"'));
  if (spec.ncx !== undefined) {
    files['OEBPS/toc.ncx'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head/><docTitle><text>demo</text></docTitle>
  <navMap>
${spec.ncx}
  </navMap>
</ncx>`);
  }
  return zipSync(files);
}

function xhtml(body: string, extraNs = ''): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"${extraNs}>
  <head><title>demo</title><style>p { margin: 0 }</style></head>
  <body>
${body}
  </body>
</html>`;
}

const DEMO_DOCS: Readonly<Record<string, string>> = {
  'cover.xhtml': '<div class="cover"><img src="cover.jpg" alt="封面"/></div>',
  'copyright.xhtml': '<h1>版权信息</h1><p>示例小说 / 示例作者</p>',
  'ch1.xhtml': `<h2 id="ch1">第一章　断剑</h2>
    <p>　　沈青崖推开铁匠铺的门时，雨水顺着斗笠边沿滴成一条线。</p>
    <p>“铁老，剑修好了吗？”他问。</p>
    <p>铁老没有抬头，手里的锤子又落了三下，才慢悠悠地说道：“修是修好了，可这剑本来就断过一次，再断就真的没救了。”</p>`,
  'ch2-3.xhtml': `<h2 id="ch2">第二章 石桥</h2>
    <p>石桥断成两截，浑浊的河水从缺口里灌过去。</p>
    <p>“人在哪儿？”沈青崖问。</p>
    <h2 id="ch3">夜谈</h2>
    <p>夜里，雨终于停了。</p>
    <p>“青崖哥，你为什么一定要用这柄剑？”她问。</p>`,
  'extra.xhtml': '<h2>番外 铁老的信</h2><p>那封信是十年前一个雨夜送到的。</p>',
  'note.xhtml': '<h2>请假一天</h2><p>今天有事，明天补上。</p>',
};

/** The demo novel as EPUB 3: nav with a volume group, two chapters in one file, an extra and an author note. */
export function demoEpub3(): Uint8Array {
  return buildEpub({
    title: '示例小说',
    author: '示例作者',
    docs: DEMO_DOCS,
    navInSpine: true,
    nav: `<nav epub:type="toc" id="toc"><h1>目录</h1><ol>
      <li><a href="cover.xhtml">封面</a></li>
      <li><a href="copyright.xhtml">版权信息</a></li>
      <li><a href="nav.xhtml">目录</a></li>
      <li><span>第一卷 云来镇</span><ol>
        <li><a href="ch1.xhtml">第一章 断剑</a></li>
        <li><a href="ch2-3.xhtml#ch2">第二章 石桥</a></li>
        <li><a href="ch2-3.xhtml#ch3">第三章 夜谈</a></li>
      </ol></li>
      <li><a href="extra.xhtml">番外 铁老的信</a></li>
      <li><a href="note.xhtml">请假一天</a></li>
    </ol></nav>`,
  });
}

/** The same book as EPUB 2 with an NCX, plus one entry whose anchor does not exist. */
export function demoEpub2(): Uint8Array {
  return buildEpub({
    title: '示例小说',
    author: '示例作者',
    docs: DEMO_DOCS,
    ncx: `<navPoint id="n1" playOrder="1"><navLabel><text>版权信息</text></navLabel><content src="copyright.xhtml"/></navPoint>
    <navPoint id="n2" playOrder="2"><navLabel><text>第一卷 云来镇</text></navLabel><content src="ch1.xhtml"/>
      <navPoint id="n3" playOrder="3"><navLabel><text>第一章 断剑</text></navLabel><content src="ch1.xhtml"/></navPoint>
      <navPoint id="n4" playOrder="4"><navLabel><text>第二章 石桥</text></navLabel><content src="ch2-3.xhtml#ch2"/></navPoint>
      <navPoint id="n5" playOrder="5"><navLabel><text>第三章 夜谈</text></navLabel><content src="ch2-3.xhtml#nope"/></navPoint>
    </navPoint>
    <navPoint id="n6" playOrder="6"><navLabel><text>番外 铁老的信</text></navLabel><content src="extra.xhtml"/></navPoint>
    <navPoint id="n7" playOrder="7"><navLabel><text>请假一天</text></navLabel><content src="note.xhtml"/></navPoint>`,
  });
}

/** No table of contents at all: headings and the chapter-marker rules have to do the work. */
export function demoEpubWithoutToc(): Uint8Array {
  return buildEpub({
    title: '无目录',
    docs: {
      'front.xhtml': '<p>作者简介：某人。</p>',
      'body.xhtml': `<h1>第一章 甲</h1><p>正文一。</p><p>第二章 乙</p><p>正文二。</p><h3>尾声</h3><p>正文三。</p><h4>不是章节</h4><p>正文四。</p>`,
    },
  });
}
