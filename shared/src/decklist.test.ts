import { describe, expect, it } from 'vitest';
import { parseDecklist } from './decklist';

const names = (text: string) => parseDecklist(text).lines.map((l) => l.name);

describe('parseDecklist', () => {
  it('reads plain names, quantities and "x" quantities', () => {
    expect(names('Sol Ring\n1 Arcane Signet\n4x Lightning Bolt\n4 x Counterspell')).toEqual([
      'Sol Ring',
      'Arcane Signet',
      'Lightning Bolt',
      'Counterspell',
    ]);
  });

  it('keeps names starting with X after a quantity', () => {
    expect(names('1 Xenagos, the Reveler')).toEqual(['Xenagos, the Reveler']);
    expect(names('2x Xenagos, the Reveler')).toEqual(['Xenagos, the Reveler']);
  });

  it('reads set code and collector number (Moxfield/Arena), lowercasing the set', () => {
    const { lines } = parseDecklist('1 Sol Ring (C21) 263\n1 Arcane Signet [CMR]\n1 Command Tower (PLST) SLD-123');
    expect(lines.map((l) => [l.name, l.setCode])).toEqual([
      ['Sol Ring', 'c21'],
      ['Arcane Signet', 'cmr'],
      ['Command Tower', 'plst'],
    ]);
  });

  it('reads foil and etched markers', () => {
    const { lines } = parseDecklist('1 Sol Ring (C21) 263 *F*\n1 Arcane Signet *E*\n1 Command Tower');
    expect(lines.map((l) => l.foil)).toEqual([true, true, false]);
  });

  it('ignores blank lines, comments and section headers', () => {
    const text = 'Commander\n1 Atraxa, Praetors\' Voice\n\n// ramp\n# note\nDeck:\n1 Sol Ring\nSIDEBOARD:\n1 Duress\nMaybeboard (3)';
    expect(names(text)).toEqual(["Atraxa, Praetors' Voice", 'Sol Ring', 'Duress']);
  });

  it('keeps split/MDFC names with //', () => {
    expect(names('1 Fire // Ice\nDelver of Secrets // Insectile Aberration')).toEqual([
      'Fire // Ice',
      'Delver of Secrets // Insectile Aberration',
    ]);
  });

  it('handles CRLF line endings and trailing spaces like LF', () => {
    expect(parseDecklist('1 Sol Ring  \r\n4x Lightning Bolt (M11) 149 \r\n')).toEqual(
      parseDecklist('1 Sol Ring\n4x Lightning Bolt (M11) 149\n'),
    );
  });

  it('merges duplicates case-insensitively: first occurrence wins, foil is OR-ed', () => {
    const { lines } = parseDecklist('1 Sol Ring (C21)\n1 sol ring (CMR) *F*');
    expect(lines).toEqual([{ name: 'Sol Ring', setCode: 'c21', foil: true, lineNo: 1 }]);
  });

  it('reports lines without a card name with their line number', () => {
    const { lines, errors } = parseDecklist('1 Sol Ring\n4\n***');
    expect(lines).toHaveLength(1);
    expect(errors).toEqual([
      { lineNo: 2, text: '4' },
      { lineNo: 3, text: '***' },
    ]);
  });

  it('strips Archidekt category tags and labels after the set and collector number', () => {
    const text = [
      '1x Sol Ring (c21) 263 [Ramp]',
      '1x Arcane Signet (c21) 236 [Mana Rock]',
      '1x Command Tower (c21) 263 ^Have,#37d67a^',
      '1x Cultivate (c21) 100 [Ramp,Land] [Draw] ^Need,#ff0000^',
      '1x Rampant Growth (c21) [Ramp]',
    ].join('\n');
    const { lines, errors } = parseDecklist(text);
    expect(errors).toEqual([]);
    expect(lines.map((l) => [l.name, l.setCode])).toEqual([
      ['Sol Ring', 'c21'],
      ['Arcane Signet', 'c21'],
      ['Command Tower', 'c21'],
      ['Cultivate', 'c21'],
      ['Rampant Growth', 'c21'],
    ]);
  });

  it('reads the foil marker when it precedes Archidekt tags', () => {
    const { lines } = parseDecklist('1x Sol Ring (c21) 263 *F* [Ramp] ^Have,#37d67a^');
    expect(lines).toEqual([{ name: 'Sol Ring', setCode: 'c21', foil: true, lineNo: 1 }]);
  });

  it('keeps the bracket set format working', () => {
    const { lines } = parseDecklist('1 Arcane Signet [CMR]');
    expect(lines).toEqual([{ name: 'Arcane Signet', setCode: 'cmr', foil: false, lineNo: 1 }]);
  });

  it('skips MTGA About and Name header lines at the top', () => {
    const { lines, errors } = parseDecklist('About\nName My Deck\n\nDeck\n1 Sol Ring\n1 Name Thief');
    expect(errors).toEqual([]);
    expect(lines.map((l) => l.name)).toEqual(['Sol Ring', 'Name Thief']);
  });
});
