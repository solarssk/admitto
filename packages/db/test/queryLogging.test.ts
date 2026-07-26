import { describe, expect, it } from 'vitest';
import { formatSlowQueryMessage, isSlowQuery } from '../src/queryLogging.js';

describe('isSlowQuery', () => {
  it('returns false below the threshold', () => {
    expect(isSlowQuery(199)).toBe(false);
  });

  it('returns true at the threshold boundary', () => {
    expect(isSlowQuery(200)).toBe(true);
  });

  it('returns true above the threshold', () => {
    expect(isSlowQuery(500)).toBe(true);
  });
});

describe('formatSlowQueryMessage', () => {
  it('includes both the duration and the query text', () => {
    const message = formatSlowQueryMessage('SELECT 1', 250);
    expect(message).toContain('250');
    expect(message).toContain('SELECT 1');
  });
});
