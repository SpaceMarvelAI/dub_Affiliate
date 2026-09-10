import { NextResponse } from "next/server";

// ALB target group health check — deliberately does nothing but respond.
// No DB/session/middleware work: this gets polled every ~30s by the load
// balancer, so it has to stay cheap regardless of what else is slow/down.
export async function GET() {
  return NextResponse.json({ ok: true });
}
