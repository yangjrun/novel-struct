import { findOne, getAttributeValue } from 'domutils';
import { unzipSync } from 'fflate';
import { parseDocument } from 'htmlparser2';
import { normalizeZipPath } from './paths.js';

/** The file is not an EPUB we can read. The message is meant for the person who supplied it. */
export class EpubFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EpubFormatError';
  }
}

export interface EpubArchive {
  /** Path of the package document (OPF), from META-INF/container.xml. */
  readonly opfPath: string;
  has(entry: string): boolean;
  /** Entry decoded as UTF-8 text, or undefined when absent. Lookup falls back to a case-insensitive match. */
  readText(entry: string): string | undefined;
}

const ZIP_LOCAL_HEADER = [0x50, 0x4b, 0x03, 0x04] as const;
const CONTAINER_PATH = 'META-INF/container.xml';
const PACKAGE_MEDIA_TYPE = 'application/oebps-package+xml';

export function isZipArchive(bytes: Uint8Array): boolean {
  return bytes.length >= ZIP_LOCAL_HEADER.length && ZIP_LOCAL_HEADER.every((b, i) => bytes[i] === b);
}

export function openEpub(bytes: Uint8Array): EpubArchive {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch (error) {
    throw new EpubFormatError(`不是有效的 ZIP 文件：${error instanceof Error ? error.message : String(error)}`);
  }
  const byPath = new Map(Object.entries(entries).map(([name, data]) => [normalizeZipPath(name), data] as const));
  const byLowerPath = new Map([...byPath.entries()].map(([name, data]) => [name.toLowerCase(), data] as const));
  const lookup = (entry: string): Uint8Array | undefined => {
    const wanted = normalizeZipPath(entry);
    return byPath.get(wanted) ?? byLowerPath.get(wanted.toLowerCase());
  };
  const readText = (entry: string): string | undefined => {
    const data = lookup(entry);
    return data === undefined ? undefined : new TextDecoder('utf-8').decode(data);
  };

  const container = readText(CONTAINER_PATH);
  if (container === undefined) throw new EpubFormatError(`缺少 ${CONTAINER_PATH}，不是 EPUB 文件`);
  const opfPath = packagePathFromContainer(container);
  if (opfPath === undefined) throw new EpubFormatError(`${CONTAINER_PATH} 里没有指向包文档的 rootfile`);
  if (lookup(opfPath) === undefined) throw new EpubFormatError(`${CONTAINER_PATH} 指向的 ${opfPath} 不存在`);

  return { opfPath, has: (entry) => lookup(entry) !== undefined, readText };
}

function packagePathFromContainer(xml: string): string | undefined {
  const doc = parseDocument(xml, { xmlMode: true });
  const isRootfile = (name: string): boolean => name.split(':').pop()?.toLowerCase() === 'rootfile';
  const preferred = findOne(
    (el) => isRootfile(el.name) && getAttributeValue(el, 'media-type') === PACKAGE_MEDIA_TYPE,
    doc.children,
    true,
  );
  const rootfile = preferred ?? findOne((el) => isRootfile(el.name), doc.children, true);
  const fullPath = rootfile === null ? undefined : getAttributeValue(rootfile, 'full-path');
  return fullPath === undefined || fullPath.trim().length === 0 ? undefined : normalizeZipPath(fullPath.trim());
}
