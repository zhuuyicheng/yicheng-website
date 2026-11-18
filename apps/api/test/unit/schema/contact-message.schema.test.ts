import { describe, expect, it } from 'vitest';
import { contactRequestSchema } from '../../../src/schema/contact-message.schema.js';

const VALID = { name: 'Ada Lovelace', email: 'ada@example.com', message: 'Hello!' };

/** The field paths and messages of every problem, or [] when valid. */
function problems(input: unknown): { path: string; message: string }[] {
  const result = contactRequestSchema.safeParse(input);
  return result.success
    ? []
    : result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
}

describe('contactRequestSchema', () => {
  it('trims every field', () => {
    const parsed = contactRequestSchema.parse({
      name: '  Ada Lovelace ',
      email: ' ada@example.com  ',
      message: '\n Hello! \n',
    });

    expect(parsed).toEqual(VALID);
  });

  it('rejects an invalid email address', () => {
    expect(problems({ ...VALID, email: 'ada@' })).toEqual([
      { path: 'email', message: 'must be a valid email address' },
    ]);
  });

  it('treats whitespace-only fields as missing', () => {
    expect(problems({ ...VALID, name: '   ', message: '\n\t' })).toEqual([
      { path: 'name', message: 'is required' },
      { path: 'message', message: 'is required' },
    ]);
  });

  it('enforces the same length limits as the CHECK constraints in migration 0005', () => {
    expect(problems({ ...VALID, name: 'a'.repeat(100), message: 'a'.repeat(5000) })).toEqual([]);
    expect(problems({ ...VALID, name: 'a'.repeat(101), message: 'a'.repeat(5001) })).toEqual([
      { path: 'name', message: 'must be at most 100 characters' },
      { path: 'message', message: 'must be at most 5000 characters' },
    ]);
    expect(problems({ ...VALID, email: `${'a'.repeat(250)}@x.io` })).toEqual([
      { path: 'email', message: 'must be at most 254 characters' },
    ]);
  });

  it('requires every field', () => {
    expect(problems({}).map((problem) => problem.path)).toEqual(['name', 'email', 'message']);
  });
});
