import { describe, expect, it } from 'vitest';
import { CliError } from '../src/errors.js';
import { shouldProceed } from '../src/commands/delete.js';

describe('shouldProceed', () => {
  it('skips the question with --yes', () => {
    expect(shouldProceed({ yes: true, isTty: false })).toBe(true);
  });

  it('accepts y and yes in any case, nothing else', () => {
    expect(shouldProceed({ yes: false, isTty: true, answer: 'y' })).toBe(true);
    expect(shouldProceed({ yes: false, isTty: true, answer: ' YES ' })).toBe(true);
    expect(shouldProceed({ yes: false, isTty: true, answer: 'n' })).toBe(false);
    expect(shouldProceed({ yes: false, isTty: true, answer: '' })).toBe(false);
    expect(shouldProceed({ yes: false, isTty: true })).toBe(false);
  });

  it('refuses to guess when stdin is not a terminal', () => {
    expect(() => shouldProceed({ yes: false, isTty: false })).toThrow(CliError);
  });
});
