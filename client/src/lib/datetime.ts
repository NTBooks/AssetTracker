export function formatLocalDateTime(input: string | number | Date | null | undefined): string {
  if (!input) return '';
  const d = new Date(input);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { timeZoneName: 'short' });
}

export function formatLocalTime(input: string | number | Date | null | undefined): string {
  if (!input) return '';
  const d = new Date(input);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { timeZoneName: 'short' });
}


