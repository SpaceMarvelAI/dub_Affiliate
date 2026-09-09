import * as client from "openid-client";

const ISSUER = process.env.OIDC_ISSUER!;
const CLIENT_ID = process.env.OIDC_CLIENT_ID!;
const CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET!;

let configPromise: Promise<client.Configuration> | undefined;

// Discovery is an HTTP round-trip, so do it once and cache the result
// instead of on every /api/auth/login hit.
export function getOidcConfig() {
  if (!configPromise) {
    configPromise = client.discovery(
      new URL(ISSUER),
      CLIENT_ID,
      CLIENT_SECRET,
    );
  }
  return configPromise;
}
