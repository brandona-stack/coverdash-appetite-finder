// Password-protects the whole site (page + data) with the browser's built-in login prompt.
// Set APPETITE_PASSWORD in Vercel > Project > Settings > Environment Variables.
// Any username works; only the password is checked.
export const config = { matcher: '/:path*' };

export default function middleware(request) {
  const password = process.env.APPETITE_PASSWORD;
  if (!password) {
    return new Response('Site is locked: APPETITE_PASSWORD is not set in Vercel.', { status: 503 });
  }
  const auth = request.headers.get('authorization') || '';
  if (auth.startsWith('Basic ')) {
    try {
      const decoded = atob(auth.slice(6));
      const supplied = decoded.slice(decoded.indexOf(':') + 1);
      if (supplied === password) return; // allowed: continue to the page
    } catch (e) {}
  }
  return new Response('Password required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Coverdash Appetite Finder", charset="UTF-8"' },
  });
}
