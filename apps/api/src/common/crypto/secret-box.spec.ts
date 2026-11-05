import { randomBytes } from 'node:crypto';
import { openSecret, parseSecretsKey, sealSecret } from './secret-box';

describe('secret box', () => {
  const key = randomBytes(32);

  it('round-trips, with a new box every time', () => {
    const a = sealSecret(key, 'sk-ant-secret', 'tenant:1');
    const b = sealSecret(key, 'sk-ant-secret', 'tenant:1');
    expect(a).not.toEqual(b);
    expect(a).not.toContain('sk-ant-secret');
    expect(openSecret(key, a, 'tenant:1')).toBe('sk-ant-secret');
  });

  it('detects a changed box', () => {
    const box = sealSecret(key, 'sk-ant-secret', 'tenant:1');
    const parts = box.split('.');
    const data = Buffer.from(parts[3] ?? '', 'base64');
    data[0] = (data[0] ?? 0) ^ 1;
    parts[3] = data.toString('base64');
    expect(() => openSecret(key, parts.join('.'), 'tenant:1')).toThrow('Unreadable secret');
  });

  it('refuses another context or another key', () => {
    const box = sealSecret(key, 'sk-ant-secret', 'tenant:1');
    expect(() => openSecret(key, box, 'tenant:2')).toThrow('Unreadable secret');
    expect(() => openSecret(randomBytes(32), box, 'tenant:1')).toThrow('Unreadable secret');
  });

  it('refuses a key of the wrong size', () => {
    expect(() => parseSecretsKey(undefined)).toThrow('32 bytes');
    expect(() => parseSecretsKey(randomBytes(16).toString('base64'))).toThrow('32 bytes');
    expect(parseSecretsKey(key.toString('base64'))).toEqual(key);
  });
});
