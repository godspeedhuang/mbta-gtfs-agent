import {timingSafeEqual} from 'node:crypto';
import {NextResponse, type NextRequest} from 'next/server';

// Optional HTTP Basic Auth for public deployments. Off unless both env vars are set,
// so local dev and self-hosted Docker keep working without credentials.
export function proxy(req: NextRequest) {
  const user = process.env.BASIC_AUTH_USER;
  const password = process.env.BASIC_AUTH_PASSWORD;
  if (!user || !password) return NextResponse.next();

  const expected = Buffer.from(`${user}:${password}`);
  const header = req.headers.get('authorization') ?? '';
  const given = header.startsWith('Basic ') ? Buffer.from(header.slice(6), 'base64') : Buffer.alloc(0);
  if (given.length === expected.length && timingSafeEqual(given, expected)) return NextResponse.next();

  return new NextResponse('Authentication required', {
    status: 401,
    headers: {'WWW-Authenticate': 'Basic realm="MBTA GTFS Agent", charset="UTF-8"'},
  });
}
