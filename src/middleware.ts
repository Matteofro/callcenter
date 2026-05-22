/**
 * Auth gate: redirect any unauthenticated request to /login, except for the
 * login page itself, the NextAuth handlers, the public webhook, and static assets.
 */
import { withAuth } from "next-auth/middleware";

export default withAuth({
  pages: { signIn: "/login" },
});

export const config = {
  matcher: [
    // Protect everything except:
    // - /login
    // - /api/auth/*       (NextAuth)
    // - /api/logistics/*  (webhook, HMAC-protected)
    // - /api/cron/*       (cron, Bearer-secret-protected)
    // - Next static assets
    "/((?!login|api/auth|api/logistics|api/cron|_next/static|_next/image|favicon.ico).*)",
  ],
};
