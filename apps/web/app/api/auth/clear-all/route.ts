import { NextRequest, NextResponse } from "next/server";

// This app sets several cookies of its own (dub_id_* / dub_test_url
// referral-tracking cookies, the session cookie, and two httpOnly ones —
// programApplicationIds and a per-program application-event cookie — that
// client-side JS can't touch at all). Rather than hardcode that list
// (guaranteed to go stale as cookies get added), this expires every cookie
// present on the request, whatever it's named. Called from the logout
// button (lib/auth/client.ts's signOut()) — this is the only cookie-clearing
// step logout does now.
//
// A cookie's Domain attribute has to match on the clearing Set-Cookie too, or
// the browser won't overwrite it (the session cookie is set with
// Domain=localhost — a plain host-only clear silently leaves it in place).
// Clear both host-only and domain-scoped forms of every cookie to be sure.
// Was hardcoded to ".dub.co" — wrong for any non-dub.co deployment (e.g.
// affiliate.spacemarvel.com), same class of bug as the *.dub.co Domain fixed
// in the auth cookie-setting routes. Derive it from the actual request host
// instead, so the domain-scoped clear actually targets a domain that could
// really have been used to set the cookie in the first place.
function getCookieDomain(host: string | null): string {
  if (process.env.NODE_ENV !== "production") return "localhost";
  if (!host) return "";
  const labels = host.split(":")[0].split(".");
  return labels.length <= 2 ? "" : `.${labels.slice(-2).join(".")}`;
}

export async function POST(req: NextRequest) {
  const res = new NextResponse(null, { status: 204 });
  const domain = getCookieDomain(req.headers.get("host"));

  for (const { name } of req.cookies.getAll()) {
    res.cookies.set(name, "", { path: "/", maxAge: 0 });
    if (domain) res.cookies.set(name, "", { path: "/", maxAge: 0, domain });
  }

  return res;
}
