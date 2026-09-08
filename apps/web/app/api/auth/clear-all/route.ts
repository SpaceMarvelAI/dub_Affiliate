import { NextRequest, NextResponse } from "next/server";

// NextAuth's own signOut() only clears its own session/CSRF cookies. This app
// also sets several of its own (dub_id_* / dub_test_url referral-tracking
// cookies, and two httpOnly ones — programApplicationIds and a per-program
// application-event cookie — that client-side JS can't touch at all). Rather
// than hardcode that list (guaranteed to go stale as cookies get added),
// this expires every cookie present on the request, whatever it's named.
// Called from the logout button before NextAuth's own signOut().
export async function POST(req: NextRequest) {
  const res = new NextResponse(null, { status: 204 });

  for (const { name } of req.cookies.getAll()) {
    res.cookies.set(name, "", { path: "/", maxAge: 0 });
  }

  return res;
}
