import { NextResponse } from 'next/server';

/**
 * Share links (phase 21) are sent on the app's domain, `/s/<token>`, and served by the
 * API's public `GET /s/:token` (the PDF, or 410 when the link is invalid). The API may
 * be same-origin behind `/api` (Caddy) or on its own domain, like NEXT_PUBLIC_API_URL.
 */
export function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  return params.then(({ token }) => {
    const base = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';
    const target = new URL(
      `${base.replace(/\/$/, '')}/s/${encodeURIComponent(token)}`,
      request.url,
    );
    const res = NextResponse.redirect(target, 307);
    // The token is the credential: no referrer, no caching of the redirect.
    res.headers.set('Referrer-Policy', 'no-referrer');
    res.headers.set('Cache-Control', 'no-store');
    return res;
  });
}
