/** Maximum number of distinct cards accepted by a single import. */
export const MAX_IMPORT_CARDS = 250;

export interface DecklistLine {
  name: string;
  /** Lowercase set code written in the list, if any. */
  setCode: string | null;
  /**
   * The set was read from [brackets], which Archidekt also uses for category tags ([ETB], [Ramp]):
   * if no such set exists for the card, any set is used instead of failing.
   */
  setGuessed: boolean;
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
// Bracketed group at the end of the line: an Archidekt category tag ([Ramp], [Ramp,Land]) or a [SET]
const TAG = /\s+\[([^\]]*)\]$/;
const SET_SHAPE = /^[A-Za-z0-9]{2,6}$/;
const PAREN_SET = /\([A-Za-z0-9]{2,6}\)/;
const FOIL = /\s+\*[FE]\*$/i;
// [quantity[x]] name [(SET) or [SET] [collector number]]
const CARD = /^(?:\d+\s*x?\s+)?(.+?)(?:\s+(?:\(([A-Za-z0-9]{2,6})\)|\[([A-Za-z0-9]{2,6})\])(?:\s+\S+)?)?$/;

/**
 * Removes the bracketed groups at the end of the line. Without a (SET) on the line, the first one
 * shaped like a set code is returned as a possible set: it cannot be told apart from a tag here.
 */
function stripTags(line: string): { line: string; bracketSet: string | null } {
  const groups: string[] = [];
  for (let m = TAG.exec(line); m; m = TAG.exec(line)) {
    groups.unshift(m[1]!);
    line = line.slice(0, m.index);
  }
  const bracketSet = PAREN_SET.test(line) ? null : (groups.find((g) => SET_SHAPE.test(g)) ?? null);
  return { line, bracketSet };
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
    const stripped = stripTags(line);
    line = stripped.line;
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
    const parenSet = match?.[2] ?? null;
    const setCode = parenSet ?? match?.[3] ?? stripped.bracketSet;
    const entry: DecklistLine = { name, setCode: setCode?.toLowerCase() ?? null, setGuessed: !parenSet && setCode !== null, foil, lineNo };
    byName.set(key, entry);
    lines.push(entry);
  });

  return { lines, errors };
}
