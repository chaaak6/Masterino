import { describe, expect, it } from 'vitest';

import { getPublicAuthErrorCode } from './errorCode';

describe('getPublicAuthErrorCode', () => {
  it.each([
    ['email-not-verified', 'EMAIL_NOT_VERIFIED'],
    ['RATE_LIMIT_EXCEEDED', 'RATE_LIMIT_EXCEEDED'],
    ['session_expired', 'SESSION_EXPIRED'],
  ])('maps a public error code without reflecting the original value', (input, expected) => {
    expect(getPublicAuthErrorCode(input)).toBe(expected);
  });

  it.each([
    'USER_ALREADY_EXISTS',
    'USER_NOT_FOUND',
    '<script>alert(1)</script>',
    'A'.repeat(65),
    '',
  ])('collapses sensitive or untrusted values to UNKNOWN: %s', (input) => {
    expect(getPublicAuthErrorCode(input)).toBe('UNKNOWN');
  });
});
