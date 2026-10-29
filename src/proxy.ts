import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import { ERROR_CODES } from "@/shared/errors";

const PUBLIC_PATHS = new Set(["/login", "/api/health"]);

export function proxy(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  if (getSessionCookie(request.headers)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    const authorization = request.headers.get("authorization");
    if (authorization?.startsWith("Bearer ")) {
      return NextResponse.next();
    }
    return NextResponse.json(
      {
        ok: false,
        code: ERROR_CODES.UNAUTHENTICATED,
        message: "请先登录",
      },
      { status: 401 },
    );
  }

  const loginUrl = new URL("/login", request.url);
  const nextPath = `${pathname}${search}`;
  if (nextPath !== "/") {
    loginUrl.searchParams.set("next", nextPath);
  }
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)",
  ],
};
