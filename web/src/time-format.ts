/** "14:02" in local time. */
export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** "Today", "Yesterday", "Tomorrow" or a short date like "Oct 14", in local time. */
export function formatDay(iso: string, now: Date): string {
  const days = Math.round((startOfDay(new Date(iso)) - startOfDay(now)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === -1) return 'Yesterday';
  if (days === 1) return 'Tomorrow';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** "14:02" today, else "Oct 14, 14:02" (or "Yesterday, 14:02"). */
export function formatWhen(iso: string, now: Date): string {
  const day = formatDay(iso, now);
  return day === 'Today' ? formatClock(iso) : `${day}, ${formatClock(iso)}`;
}

/** "Updated at 14:02", "Updated yesterday at 14:02", "Updated Oct 12 at 14:02". */
export function formatAt(prefix: string, iso: string, now: Date): string {
  const day = formatDay(iso, now);
  const when = day === 'Today' ? '' : ` ${day === 'Yesterday' || day === 'Tomorrow' ? day.toLowerCase() : day}`;
  return `${prefix}${when} at ${formatClock(iso)}`;
}
