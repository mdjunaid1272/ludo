import { describe, it, expect } from 'vitest';
import { parseClientMessage, isRoomCode, isToken, normalizeCode, ROOM_CODE_ALPHABET, MAX_MESSAGE_BYTES } from '../src/online/protocol.js';

const parse = (obj) => parseClientMessage(typeof obj === 'string' ? obj : JSON.stringify(obj));
const ok = (obj) => {
  const r = parse(obj);
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r.msg;
};
const rejected = (obj) => {
  const r = parse(obj);
  expect(r.ok, JSON.stringify(obj)).toBe(false);
  return r.error;
};
const TOKEN = 'abcdefghijklmnop_-0123456789';

describe('room codes', () => {
  it('use 4 consonants and are normalised from user input', () => {
    expect(isRoomCode('BCDF')).toBe(true);
    expect(normalizeCode('  bcdf ')).toBe('BCDF');
    expect(normalizeCode(undefined)).toBe('');
    for (const bad of ['', 'ABC', 'BCDFG', 'BCD1', 'bcdf', 'AEIO', 'BC F', null, 12, ['B', 'C', 'D', 'F']]) {
      expect(isRoomCode(bad), String(bad)).toBe(false);
    }
  });

  it('use an alphabet without vowels or digits', () => {
    expect(ROOM_CODE_ALPHABET).toHaveLength(20);
    expect(new Set(ROOM_CODE_ALPHABET).size).toBe(20);
    expect(ROOM_CODE_ALPHABET).not.toMatch(/[AEIOUY0-9]/);
  });
});

describe('tokens', () => {
  it('are 16-64 URL-safe characters', () => {
    expect(isToken(TOKEN)).toBe(true);
    for (const bad of ['short', 'a'.repeat(65), 'has space 123456789012', 'sym$bols$$$$$$$$$$$$', '', null, 5]) expect(isToken(bad)).toBe(false);
  });
});

describe('parseClientMessage: valid messages', () => {
  it('accepts every message type and returns a cleaned copy', () => {
    expect(ok({ t: 'create', seats: 3 })).toEqual({ t: 'create', seats: 3 });
    expect(ok({ t: 'join', code: 'bcdf' })).toEqual({ t: 'join', code: 'BCDF' });
    expect(ok({ t: 'rejoin', code: 'BCDF', token: TOKEN })).toEqual({ t: 'rejoin', code: 'BCDF', token: TOKEN });
    expect(ok({ t: 'color', color: 'blue' })).toEqual({ t: 'color', color: 'blue' });
    expect(ok({ t: 'removeAi', color: 'green' })).toEqual({ t: 'removeAi', color: 'green' });
    expect(ok({ t: 'move', index: 2 })).toEqual({ t: 'move', index: 2 });
    for (const t of ['addAi', 'start', 'rematch', 'roll', 'sync', 'leave', 'ping']) expect(ok({ t })).toEqual({ t });
  });

  it('fills in the full rules for create and keeps the difficulty', () => {
    const msg = ok({ t: 'create', seats: 4, rules: { blockades: true }, difficulty: 'hard' });
    expect(msg.rules).toMatchObject({ blockades: true, tripleSix: 'forfeit', sixGrantsExtra: true });
    expect(msg.difficulty).toBe('hard');
  });

  it('drops unknown extra fields', () => {
    expect(ok({ t: 'roll', admin: true, __proto__: { x: 1 } })).toEqual({ t: 'roll' });
    expect(ok({ t: 'move', index: 1, hack: 'x' })).toEqual({ t: 'move', index: 1 });
  });
});

describe('parseClientMessage: rejects bad input without throwing', () => {
  it('rejects non-JSON, non-objects and unknown types', () => {
    for (const raw of ['', 'not json', '{', 'null', '[]', '42', '"roll"', 'true', '{"t":1}', '{"t":"nope"}', '{}', '{"t":"toString"}', '{"t":"constructor"}', '{"t":"__proto__"}']) {
      expect(rejected(raw), raw).toBeTruthy();
    }
  });

  it('rejects binary and oversized messages', () => {
    expect(parseClientMessage(12345).ok).toBe(false);
    expect(parseClientMessage(undefined).ok).toBe(false);
    expect(parseClientMessage(JSON.stringify({ t: 'ping', pad: 'x'.repeat(MAX_MESSAGE_BYTES) })).ok).toBe(false);
  });

  it('accepts a Buffer containing JSON text (as ws delivers it)', () => {
    expect(parseClientMessage(Buffer.from('{"t":"roll"}')).ok).toBe(true);
  });

  it('validates every field', () => {
    for (const seats of [1, 5, '3', 2.5, null, undefined, -1]) rejected({ t: 'create', seats });
    rejected({ t: 'create', seats: 2, rules: [] });
    rejected({ t: 'create', seats: 2, rules: 'x' });
    rejected({ t: 'create', seats: 2, rules: { bogus: true } });
    rejected({ t: 'create', seats: 2, rules: { tripleSix: 'maybe' } });
    rejected({ t: 'create', seats: 2, difficulty: 'impossible' });
    for (const code of ['', 'ABC', 'AEIO', 12, null]) rejected({ t: 'join', code });
    rejected({ t: 'rejoin', code: 'BCDF', token: 'short' });
    rejected({ t: 'rejoin', code: 'XXXX1', token: TOKEN });
    for (const color of ['pink', '', null, 3, 'RED']) rejected({ t: 'color', color });
    for (const index of [-1, 4, 1.5, '1', null, undefined, NaN, Infinity]) rejected({ t: 'move', index });
    rejected({ t: 'removeAi' });
  });

  it('returns an error message, never throws, for hostile input', () => {
    const nasty = ['{"t":"move","index":{"valueOf":1}}', '{"t":"join","code":{"toString":"x"}}', '{"t":"create","seats":2,"rules":{"__proto__":{"admin":true}}}', '\u0000', '{"t":"roll"}\u0000'];
    for (const raw of nasty) expect(() => parseClientMessage(raw)).not.toThrow();
  });
});
