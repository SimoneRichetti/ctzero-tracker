import { CONDITION_ABBR, formatEuro, type Condition, type Listing } from '@ctzero/shared';
import type { AlertEvent } from './rules';

export interface ReportItem {
  cardName: string;
  listing: Listing | null;
  event: AlertEvent;
}

export interface ReportError {
  cardName: string;
  message: string;
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function formatDate(at: Date): string {
  const hours = at.getHours();
  const period = hours < 12 ? 'AM' : 'PM';
  return `${pad(at.getMonth() + 1)}/${pad(at.getDate())} ${pad(hours % 12 || 12)}:${pad(at.getMinutes())} ${period}`;
}

function describeListing(l: Listing | null): string {
  if (!l) return '';
  const parts = [l.expansionName, CONDITION_ABBR[l.condition as Condition] ?? l.condition, l.language.toUpperCase()];
  if (l.foil) parts.push('foil');
  return ` (${escapeHtml(parts.join(', '))})`;
}

function link(l: Listing | null): string {
  return l ? ` → <a href="${escapeHtml(l.url)}">link</a>` : '';
}

function itemLine(item: ReportItem): string {
  const name = escapeHtml(item.cardName);
  const e = item.event;
  switch (e.kind) {
    case 'below':
      return `• ${name}${describeListing(item.listing)} — ${formatEuro(e.priceCents)} (threshold ${formatEuro(e.thresholdCents)}, ${formatEuro(e.thresholdCents - e.priceCents)} below)${link(item.listing)}`;
    case 'further_drop':
      return `• ${name}${describeListing(item.listing)} — ${formatEuro(e.priceCents)} (was ${formatEuro(e.previousCents)})${link(item.listing)}`;
    case 'back_above':
      return e.priceCents === null
        ? `• ${name} — no valid CT Zero offers (threshold ${formatEuro(e.thresholdCents)})`
        : `• ${name} — ${formatEuro(e.priceCents)} (threshold ${formatEuro(e.thresholdCents)})`;
  }
}

const SECTIONS: { kind: AlertEvent['kind']; title: string }[] = [
  { kind: 'below', title: '🟢 <b>Below threshold</b>' },
  { kind: 'further_drop', title: '📉 <b>Further drop</b>' },
  { kind: 'back_above', title: '🔁 <b>Back above threshold</b>' },
];

export function buildReport(items: ReportItem[], errors: ReportError[], at: Date): string | null {
  if (items.length === 0 && errors.length === 0) return null;
  const blocks: string[] = [`🃏 <b>CTZero Tracker</b> — ${formatDate(at)}`];
  for (const section of SECTIONS) {
    const lines = items.filter((i) => i.event.kind === section.kind).map(itemLine);
    if (lines.length > 0) blocks.push([section.title, ...lines].join('\n'));
  }
  if (errors.length > 0) {
    const lines = errors.map((e) => `• ${escapeHtml(e.cardName)} — ${escapeHtml(e.message)}`);
    blocks.push(['❌ <b>Errors</b>', ...lines].join('\n'));
  }
  return blocks.join('\n\n');
}

export function buildFatalMessage(message: string, at: Date): string {
  return `⚠️ <b>CTZero Tracker</b> — ${formatDate(at)}\nPrice update failed: ${escapeHtml(message)}`;
}
