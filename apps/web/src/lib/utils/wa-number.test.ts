import { describe, it, expect } from 'vitest';
import { validateWaNumber, sanitizeWaNumber } from './wa-number';

describe('validateWaNumber', () => {
  it('accepts valid international WA number starting with 62', () => {
    expect(validateWaNumber('6281234567890')).toBe(true);
    expect(validateWaNumber('628000000000')).toBe(true);
  });

  it('rejects number with local format (starting with 0)', () => {
    expect(validateWaNumber('081234567890')).toBe(false);
  });

  it('rejects number not starting with 62', () => {
    expect(validateWaNumber('1234567890')).toBe(false);
  });

  it('rejects number that is too short (< 10 digits)', () => {
    expect(validateWaNumber('62812')).toBe(false);
  });

  it('rejects number that is too long (> 15 digits)', () => {
    expect(validateWaNumber('6281234567890123456')).toBe(false);
  });

  it('rejects number with non-digit characters', () => {
    expect(validateWaNumber('6281234-56789')).toBe(false);
    expect(validateWaNumber('+6281234567890')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(validateWaNumber('')).toBe(false);
  });
});

describe('sanitizeWaNumber', () => {
  it('keeps number already in correct format', () => {
    expect(sanitizeWaNumber('6281234567890')).toBe('6281234567890');
  });

  it('converts local format (0xxx) to international format (62xxx)', () => {
    expect(sanitizeWaNumber('081234567890')).toBe('6281234567890');
  });

  it('strips non-digit characters', () => {
    expect(sanitizeWaNumber('+62 812-3456-7890')).toBe('6281234567890');
  });

  it('handles number with spaces', () => {
    expect(sanitizeWaNumber('62 812 345 6789')).toBe('628123456789');
  });
});
