import { NextResponse, type NextRequest } from 'next/server';

// Only the /account page (not login/register) requires auth.
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname !== '/account') return NextResponse.next();
  const hasSession = req.cookies.get('cust_sid')?.value;
  if (!hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = '/account/login';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/account'],
};
