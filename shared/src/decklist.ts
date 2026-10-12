/** Maximum number of distinct cards accepted by a single import. */
export const MAX_IMPORT_CARDS = 250;

export interface DecklistLine {
  name: string;
  /** Lowercase set code written in the list, if any. */
  setCode: string | null;
  foil: boolean;
  /** 1-based line of the first occurrence. */
  lineNo: number;
}

export interface DecklistError {
  lineNo: number;
  text: string;
}

export interface ParsedDecklist {
  lines: DecklistLine[];
  errors: DecklistError[];
}

const SECTION =
  /^(about|deck|main\s*deck|mainboard|sideboard|commanders?|companions?|maybeboard|considering|tokens?)\s*:?\s*(\(\d+\))?$/i;
// Archidekt trailing label: ^Have,#37d67a^
const LABEL = /\s+\^[^^]*\^$/;
// Archidekt category tag at the end of the line, e.g. [Ramp] or [Ramp,Land]
const TAG = /\s+\[([^\]]*)\]$/;
// [SET] is also a set format: only an all-uppercase code, with no (SET) before it, is read as one
const BRACKET_SET = /^[A-Z0-9]{2,6}$/;
const PAREN_SET = /\([A-Za-z0-9]{2,6}\)/;
const FOIL = /\s+\*[FE]\*$/i;
// [quantity[x]] name [(SET) or [SET] [collector number]]
const CARD = /^(?:\d+\s*x?\s+)?(.+?)(?:\s+[([]([A-Za-z0-9]{2,6})[)\]](?:\s+\S+)?)?$/;

function stripTags(line: string): string {
  for (let m = TAG.exec(line); m; m = TAG.exec(line)) {
    const before = line.slice(0, m.index);
    if (BRACKET_SET.test(m[1]!) && !PAREN_SET.test(before)) break;
    line = before;
  }
  return line;
}

/**
 * Parses a text decklist (Moxfield, Archidekt, MTGA, plain names), one card per line.
 * Quantities and collector numbers are ignored; duplicates are merged.
 */
export function parseDecklist(text: string): ParsedDecklist {
  const lines: DecklistLine[] = [];
  const errors: DecklistError[] = [];
  const byName = new Map<string, DecklistLine>();

  let seenCard = false;
  text.split(/\r?\n/).forEach((raw, i) => {
    const lineNo = i + 1;
    let line = raw.trim();
    if (line === '' || line.startsWith('//') || line.startsWith('#') || SECTION.test(line)) return;
    // MTGA exports start with "About" and "Name <deck name>" lines
    if (!seenCard && /^name\s/i.test(line)) return;
    line = line.replace(LABEL, '');
    line = stripTags(line);
    const foil = FOIL.test(line);
    if (foil) line = line.replace(FOIL, '');
    const match = CARD.exec(line);
    const name = match?.[1]?.trim() ?? '';
    if (!/\p{L}/u.test(name)) {
      errors.push({ lineNo, text: raw.trim() });
      return;
    }
    seenCard = true;
    const key = name.toLowerCase();
    const existing = byName.get(key);
    if (existing) {
      existing.foil ||= foil;
      return;
    }
    const entry: DecklistLine = { name, setCode: match?.[2]?.toLowerCase() ?? null, foil, lineNo };
    byName.set(key, entry);
    lines.push(entry);
  });

  return { lines, errors };
}
