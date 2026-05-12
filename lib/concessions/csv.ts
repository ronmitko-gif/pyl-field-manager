type Row = { time: string; name: string; email: string };

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function signupsToCsv(rows: Row[]): string {
  const lines = ['Time,Name,Email'];
  for (const r of rows) {
    lines.push([r.time, r.name, r.email].map(csvEscape).join(','));
  }
  return lines.join('\n') + '\n';
}
