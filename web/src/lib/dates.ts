// Dates are local calendar days ("YYYY-MM-DD") and times are local wall-clock
// ("HH:MM"): a pill due at 8:00 is due at 8:00 wherever the phone is.

const pad = (n: number) => String(n).padStart(2, '0');

export const toDateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function fromDateStr(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export const today = () => toDateStr(new Date());

export const timeOf = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function nowTime(): string {
  return timeOf(new Date());
}

export function addDays(date: string, n: number): string {
  const d = fromDateStr(date);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

export const dayOfWeek = (date: string) => fromDateStr(date).getDay();

export const weekStart = (date: string) => addDays(date, -dayOfWeek(date));

export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function dateTimeOf(date: string, time: string): Date {
  const d = fromDateStr(date);
  const [h, m] = time.split(':').map(Number);
  d.setHours(h, m, 0, 0);
  return d;
}

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

export const formatTime = (time: string) => timeFormat.format(dateTimeOf('2000-01-01', time));

export const formatClock = (iso: string) => timeFormat.format(new Date(iso));

export function formatDate(date: string, options: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric' }) {
  return new Intl.DateTimeFormat(undefined, options).format(fromDateStr(date));
}

/** "Today", "Yesterday", "Tomorrow", or the weekday and date. */
export function friendlyDate(date: string): string {
  const t = today();
  const short = formatDate(date, { weekday: 'short', month: 'short', day: 'numeric' });
  if (date === t) return `Today, ${short}`;
  if (date === addDays(t, -1)) return `Yesterday, ${short}`;
  if (date === addDays(t, 1)) return `Tomorrow, ${short}`;
  return formatDate(date);
}

export function partOfDay(time: string): 'Morning' | 'Afternoon' | 'Evening' | 'Night' {
  const hour = Number(time.slice(0, 2));
  if (hour >= 4 && hour < 12) return 'Morning';
  if (hour >= 12 && hour < 17) return 'Afternoon';
  if (hour >= 17 && hour < 21) return 'Evening';
  return 'Night';
}

export const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "4 hr", "30 min", "1 hr 30 min". */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h ? `${h} hr` : '', m || !h ? `${m} min` : ''].filter(Boolean).join(' ');
}
