import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { ErrorCode } from '@erp/shared';
import { AppException } from '../common/app-exception';

const PRIVATE = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 3],
] as const) {
  PRIVATE.addSubnet(net, prefix, 'ipv4');
}
PRIVATE.addAddress('::', 'ipv6');
PRIVATE.addAddress('::1', 'ipv6');
PRIVATE.addSubnet('fc00::', 7, 'ipv6');
PRIVATE.addSubnet('fe80::', 10, 'ipv6');
PRIVATE.addSubnet('ff00::', 8, 'ipv6');

export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  if (mapped) return PRIVATE.check(mapped, 'ipv4');
  return PRIVATE.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

type Resolve = (host: string) => Promise<{ address: string }[]>;

/**
 * In SaaS mode a company's base URL is a request our server makes for it: without this
 * check it could point at our own network (SSRF). Run on save and again before each use,
 * because a name can change address later.
 */
export async function assertPublicHttpsUrl(
  url: string,
  resolve: Resolve = (host) => lookup(host, { all: true }),
): Promise<void> {
  const refuse = () =>
    new AppException(ErrorCode.AI_BASE_URL_NOT_ALLOWED, 'This base URL is not allowed');
  const parsed = URL.canParse(url) ? new URL(url) : null;
  if (parsed?.protocol !== 'https:') throw refuse();
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host)
    ? [{ address: host }]
    : await resolve(host).catch(() => {
        throw refuse();
      });
  if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) throw refuse();
}
