/**
 * IRI references for RDF/XML and JSON-LD: the absolute-IRI test and RFC 3986 §5.2 resolution.
 * Absolute IRIs are kept as written, as n3 does for Turtle, so one resource gets one id
 * whichever syntax names it. Pure string operations; nothing is ever fetched.
 */

const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

/** RFC 3986 appendix B: scheme, authority, path, query, fragment. */
const PARTS = /^(?:([^:/?#]+):)?(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/s;

const DOT_SEGMENT = /(?:^|\/)\.\.?(?:\/|$)/;

/** `true` when `value` starts with a scheme (`http:`, `urn:`, `_:` does not count). */
export function isAbsoluteIri(value: string): boolean {
  return SCHEME.test(value);
}

/**
 * Resolves an IRI reference against `base` (RFC 3986 §5.2.2). Absolute references come back
 * unchanged; without a base, relative references stay relative (as in Turtle without `@base`).
 */
export function resolveIri(reference: string, base: string | undefined): string {
  if (base === undefined || base === '' || SCHEME.test(reference)) return reference;
  const r = PARTS.exec(reference);
  const b = PARTS.exec(base);
  if (!r || !b) return reference;
  const [, , rAuthority, rPath = '', rQuery, rFragment] = r;
  const [, bScheme, bAuthority, bPath = '', bQuery] = b;
  let authority = bAuthority;
  let path: string;
  let query = rQuery;
  if (rAuthority !== undefined) {
    authority = rAuthority;
    path = removeDotSegments(rPath);
  } else if (rPath === '') {
    path = bPath;
    query = rQuery ?? bQuery;
  } else if (rPath.startsWith('/')) {
    path = removeDotSegments(rPath);
  } else {
    // Merge (§5.2.3): a base with an authority and an empty path merges under "/".
    const merged =
      bAuthority !== undefined && bPath === ''
        ? `/${rPath}`
        : bPath.slice(0, bPath.lastIndexOf('/') + 1) + rPath;
    path = removeDotSegments(merged);
  }
  return (
    (bScheme !== undefined ? `${bScheme}:` : '') +
    (authority !== undefined ? `//${authority}` : '') +
    path +
    (query !== undefined ? `?${query}` : '') +
    (rFragment !== undefined ? `#${rFragment}` : '')
  );
}

/** RFC 3986 §5.2.4, literally: `/a/b/../c/./d` → `/a/c/d`. */
function removeDotSegments(path: string): string {
  if (!DOT_SEGMENT.test(path)) return path;
  let input = path;
  let output = '';
  const dropLastSegment = () => {
    output = output.slice(0, Math.max(0, output.lastIndexOf('/')));
  };
  while (input !== '') {
    if (input.startsWith('../')) input = input.slice(3);
    else if (input.startsWith('./')) input = input.slice(2);
    else if (input.startsWith('/./')) input = input.slice(2);
    else if (input === '/.') input = '/';
    else if (input.startsWith('/../')) {
      input = input.slice(3);
      dropLastSegment();
    } else if (input === '/..') {
      input = '/';
      dropLastSegment();
    } else if (input === '.' || input === '..') input = '';
    else {
      const next = input.indexOf('/', 1);
      const end = next < 0 ? input.length : next;
      output += input.slice(0, end);
      input = input.slice(end);
    }
  }
  return output;
}
