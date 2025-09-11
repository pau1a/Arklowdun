const ENTITY_MAP: Record<string, string> = {
  '<': '&lt;',
  '>': '&gt;',
  '&': '&amp;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(input: string): string {
  // TODO: this scans forward with indexOf for every '&'. If profiling ever
  // shows it hot, replace with a small state machine to avoid potential
  // quadratic behaviour on pathological strings.
  let out = '';
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '&') {
      const semi = input.indexOf(';', i + 1);
      if (semi > -1) {
        const entity = input.slice(i + 1, semi);
        if (/^#?[0-9a-zA-Z]+$/.test(entity)) {
          out += '&' + entity + ';';
          i = semi;
          continue;
        }
      }
    }
    const replacement = ENTITY_MAP[ch];
    out += replacement ? replacement : ch;
  }
  return out;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function entityEnd(str: string, idx: number): number {
  const amp = str.lastIndexOf('&', idx);
  if (amp === -1) return -1;
  const semi = str.indexOf(';', amp);
  return semi !== -1 && semi > idx ? semi + 1 : -1;
}

export function highlight(text: string, query: string, maxHits = 50): string {
  if (!query) return escapeHtml(text);
  // Uses JS RegExp case-folding which is effectively ASCII-centric; locale
  // special-casing (e.g. ß vs "ss") is not handled.
  const pattern = new RegExp(escapeRegex(query), 'gi');
  let result = '';
  let last = 0;
  let match: RegExpExecArray | null;
  let hits = 0;
  while ((match = pattern.exec(text)) && hits < maxHits) {
    const end = entityEnd(text, match.index);
    if (end !== -1) {
      result += escapeHtml(text.slice(last, end));
      last = end;
      pattern.lastIndex = end;
      continue;
    }
    result += escapeHtml(text.slice(last, match.index));
    result += `<mark class="search-hit">${escapeHtml(match[0])}</mark>`;
    last = match.index + match[0].length;
    hits++;
  }
  result += escapeHtml(text.slice(last));
  return result;
}

export { escapeHtml };
