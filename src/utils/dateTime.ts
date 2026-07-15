const BOGOTA_TIME_ZONE = 'America/Bogota';

function normalizeDayPeriod(value: string): string {
  const cleaned = value.trim().toLowerCase();
  if (cleaned.includes('a')) return 'am';
  if (cleaned.includes('p')) return 'pm';
  return cleaned;
}

export function parseApiDate(value?: string | number | Date | null): Date | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const trimmed = value.trim();
  if (!trimmed) return null;

  const hasExplicitTimezone = /(?:z|[+-]\d{2}:\d{2})$/i.test(trimmed);
  const normalized = hasExplicitTimezone ? trimmed : `${trimmed}Z`;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatBogotaDateTime(value?: string | number | Date | null): string {
  const parsed = parseApiDate(value);
  if (!parsed) return typeof value === 'string' && value.trim() ? value : '—';

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BOGOTA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(parsed);

  const month = parts.find((part) => part.type === 'month')?.value ?? '--';
  const day = parts.find((part) => part.type === 'day')?.value ?? '--';
  const year = parts.find((part) => part.type === 'year')?.value ?? '----';
  const hour = parts.find((part) => part.type === 'hour')?.value ?? '--';
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '--';
  const dayPeriod = normalizeDayPeriod(parts.find((part) => part.type === 'dayPeriod')?.value ?? '');

  return `${day}/${month}/${year}, ${hour}:${minute} ${dayPeriod}`;
}

export function formatBogotaShortDateTime(value?: string | number | Date | null): string {
  const parsed = parseApiDate(value);
  if (!parsed) return typeof value === 'string' && value.trim() ? value : '—';

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BOGOTA_TIME_ZONE,
    month: 'short',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(parsed);

  const month = parts.find((part) => part.type === 'month')?.value ?? '---';
  const day = parts.find((part) => part.type === 'day')?.value ?? '--';
  const hour = parts.find((part) => part.type === 'hour')?.value ?? '--';
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '--';
  const dayPeriod = normalizeDayPeriod(parts.find((part) => part.type === 'dayPeriod')?.value ?? '');

  return `${day} ${month}, ${hour}:${minute} ${dayPeriod}`;
}

