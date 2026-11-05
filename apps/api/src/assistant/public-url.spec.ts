import { assertPublicHttpsUrl, isPrivateAddress } from './public-url';

describe('company base URLs', () => {
  const resolvesTo = (address: string) => () => Promise.resolve([{ address }]);

  it.each(['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '::1'])(
    'treats %s as private',
    (address) => expect(isPrivateAddress(address)).toBe(true),
  );

  it('sees through an IPv4-mapped address', () => {
    expect(isPrivateAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateAddress('::ffff:8.8.8.8')).toBe(false);
  });

  it('accepts a public https host', async () => {
    await expect(
      assertPublicHttpsUrl('https://api.mistral.ai/v1', resolvesTo('51.159.0.1')),
    ).resolves.toBeUndefined();
  });

  it.each([
    ['http://api.mistral.ai/v1', '51.159.0.1'],
    ['https://169.254.169.254/latest', '0.0.0.0'],
    ['https://[::1]/v1', '0.0.0.0'],
    ['https://evil.example/v1', '10.0.0.5'],
    ['not a url', '51.159.0.1'],
  ])('refuses %s', async (url, address) => {
    await expect(assertPublicHttpsUrl(url, resolvesTo(address))).rejects.toThrow('not allowed');
  });

  it('refuses a name that does not resolve', async () => {
    await expect(
      assertPublicHttpsUrl('https://nowhere.example', () => Promise.reject(new Error('ENOTFOUND'))),
    ).rejects.toThrow('not allowed');
  });
});
