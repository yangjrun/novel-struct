import path from 'node:path';

export interface HrefTarget {
  /** Zip entry path, normalized, no leading `./` or `/`. */
  readonly path: string;
  readonly fragment?: string;
}

/**
 * Resolves an href found in `basePath` (an OPF, NCX or XHTML file inside the archive) to a zip
 * entry path plus optional fragment. Percent-encoding is undone; a bare `#id` stays in `basePath`.
 */
export function resolveHref(basePath: string, href: string): HrefTarget {
  const hashAt = href.indexOf('#');
  const rawPath = (hashAt === -1 ? href : href.slice(0, hashAt)).trim();
  const fragment = hashAt === -1 ? '' : safeDecode(href.slice(hashAt + 1));
  const decoded = safeDecode(rawPath);
  const resolved =
    decoded.length === 0
      ? basePath
      : decoded.startsWith('/')
        ? normalizeZipPath(decoded)
        : normalizeZipPath(path.posix.join(path.posix.dirname(basePath), decoded));
  return fragment.length === 0 ? { path: resolved } : { path: resolved, fragment };
}

export function normalizeZipPath(entry: string): string {
  return path.posix.normalize(entry.replace(/\\/g, '/')).replace(/^(?:\.\/|\/)+/, '');
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
