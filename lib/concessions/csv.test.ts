import { describe, it, expect } from 'vitest';
import { signupsToCsv } from './csv';

describe('signupsToCsv', () => {
  it('emits a header + one row per signup', () => {
    const csv = signupsToCsv([
      { time: '9:00 AM – 10:00 AM', name: 'Alice', email: 'a@x.com' },
      { time: '10:00 AM – 11:00 AM', name: 'Bob', email: 'b@x.com' },
    ]);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('Time,Name,Email');
    expect(lines[1]).toBe('9:00 AM – 10:00 AM,Alice,a@x.com');
    expect(lines[2]).toBe('10:00 AM – 11:00 AM,Bob,b@x.com');
  });

  it('quotes fields containing commas or quotes', () => {
    const csv = signupsToCsv([
      { time: '9:00 AM – 10:00 AM', name: 'Smith, John', email: 'js@x.com' },
      { time: '10:00 AM – 11:00 AM', name: 'O\'Brien "Pat"', email: 'pat@x.com' },
    ]);
    expect(csv).toContain('"Smith, John"');
    expect(csv).toContain('"O\'Brien ""Pat"""');
  });
});
