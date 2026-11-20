// Minimal YAML subset parser: block maps, block lists, inline [a, b] and {k: v} flow values,
// scalars (string, number, boolean, null), and # comments. No anchors, multiline scalars or tags.

export class YamlError extends Error {
  constructor(message: string, readonly line: number) {
    super(`line ${line}: ${message}`);
  }
}

interface Line { indent: number; text: string; no: number }

function stripComment(s: string): string {
  let q: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === '#' && (i === 0 || /\s/.test(s[i - 1]!))) return s.slice(0, i);
  }
  return s;
}

function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0, q: string | null = null, cur = '';
  for (const c of s) {
    if (q) { cur += c; if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '[' || c === '{') depth++;
    if (c === ']' || c === '}') depth--;
    if (c === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim() !== '') out.push(cur);
  return out;
}

function findColon(s: string): number {
  let q: string | null = null, depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') depth--;
    else if (c === ':' && depth === 0 && (i === s.length - 1 || /\s/.test(s[i + 1]!))) return i;
  }
  return -1;
}

function scalar(raw: string, no: number): unknown {
  const s = raw.trim();
  if (s === '' || s === '~' || s === 'null') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (s[0] === '"' || s[0] === "'") {
    if (s.length < 2 || s[s.length - 1] !== s[0]) throw new YamlError('unterminated string', no);
    return s.slice(1, -1);
  }
  if (s[0] === '[') {
    if (s[s.length - 1] !== ']') throw new YamlError('unterminated flow list', no);
    return splitTop(s.slice(1, -1)).map((p) => scalar(p, no));
  }
  if (s[0] === '{') {
    if (s[s.length - 1] !== '}') throw new YamlError('unterminated flow map', no);
    const o: Record<string, unknown> = {};
    for (const p of splitTop(s.slice(1, -1))) {
      const c = findColon(p);
      if (c < 0) throw new YamlError(`bad flow map entry "${p.trim()}"`, no);
      o[String(scalar(p.slice(0, c), no))] = scalar(p.slice(c + 1), no);
    }
    return o;
  }
  return s;
}

export function parseYaml(src: string): unknown {
  const lines: Line[] = [];
  src.split(/\r?\n/).forEach((l, i) => {
    if (/\t/.test(l.match(/^\s*/)![0])) throw new YamlError('tabs are not allowed for indentation', i + 1);
    const t = stripComment(l).replace(/\s+$/, '');
    if (t.trim() === '') return;
    lines.push({ indent: t.length - t.trimStart().length, text: t.trim(), no: i + 1 });
  });
  if (lines.length === 0) return null;
  let pos = 0;

  function block(indent: number): unknown {
    const first = lines[pos]!;
    return first.text === '-' || first.text.startsWith('- ') ? list(indent) : map(indent);
  }

  function value(rest: string, parentIndent: number, no: number): unknown {
    if (rest !== '') return scalar(rest, no);
    const next = lines[pos];
    if (next && next.indent > parentIndent) return block(next.indent);
    return null;
  }

  function map(indent: number, inline?: { key: string; rest: string; no: number }): Record<string, unknown> {
    const o: Record<string, unknown> = {};
    const put = (text: string, no: number, ind: number): void => {
      const c = findColon(text);
      if (c < 0) throw new YamlError(`expected "key: value", got "${text}"`, no);
      const key = String(scalar(text.slice(0, c), no));
      if (key in o) throw new YamlError(`duplicate key "${key}"`, no);
      o[key] = value(text.slice(c + 1).trim(), ind, no);
    };
    if (inline) put(`${inline.key}:${inline.rest}`, inline.no, indent);
    while (pos < lines.length) {
      const l = lines[pos]!;
      if (l.indent < indent) break;
      if (l.indent > indent) throw new YamlError('unexpected indentation', l.no);
      if (l.text.startsWith('- ') || l.text === '-') break;
      pos++;
      put(l.text, l.no, indent);
    }
    return o;
  }

  function list(indent: number): unknown[] {
    const a: unknown[] = [];
    while (pos < lines.length) {
      const l = lines[pos]!;
      if (l.indent < indent) break;
      if (l.indent > indent) throw new YamlError('unexpected indentation', l.no);
      if (!(l.text === '-' || l.text.startsWith('- '))) break;
      pos++;
      const rest = l.text.slice(1).trim();
      if (rest === '') {
        const next = lines[pos];
        a.push(next && next.indent > indent ? block(next.indent) : null);
      } else if (findColon(rest) >= 0 && rest[0] !== '[' && rest[0] !== '{' && rest[0] !== '"' && rest[0] !== "'") {
        const c = findColon(rest);
        const itemIndent = indent + (l.text.length - l.text.slice(1).trimStart().length);
        a.push(map(itemIndent, { key: rest.slice(0, c), rest: rest.slice(c + 1), no: l.no }));
      } else {
        a.push(scalar(rest, l.no));
      }
    }
    return a;
  }

  const result = block(lines[0]!.indent);
  if (pos < lines.length) throw new YamlError('unexpected content', lines[pos]!.no);
  return result;
}
