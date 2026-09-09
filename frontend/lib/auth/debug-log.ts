// Verbose, color-coded console logging for the SpaceMarvel OIDC login flow.
// Dev/localhost only — no-ops entirely in production so no claims, tokens,
// or provider config ever reach a production console.
const isDev = process.env.NODE_ENV !== "production";

const BADGES = {
  config: ["#7C3AED", "OIDC CONFIG"],
  client: ["#DB2777", "CLIENT"],
  signin: ["#2563EB", "SIGNIN"],
  jwt: ["#059669", "JWT"],
  session: ["#D97706", "SESSION"],
  warn: ["#CA8A04", "WARN"],
  error: ["#DC2626", "ERROR"],
} as const;

type Badge = keyof typeof BADGES;

export function authDebug(badge: Badge, message: string, data?: unknown) {
  if (!isDev) return;

  const [color, label] = BADGES[badge];
  const badgeStyle = `background:${color};color:#fff;padding:2px 6px;border-radius:4px;font-weight:600;font-size:11px;`;
  const resetStyle = "color:inherit;font-weight:normal;";

  if (data !== undefined) {
    // eslint-disable-next-line no-console
    console.groupCollapsed(`%c${label}%c ${message}`, badgeStyle, resetStyle);
    // eslint-disable-next-line no-console
    console.log(data);
    // eslint-disable-next-line no-console
    console.groupEnd();
  } else {
    // eslint-disable-next-line no-console
    console.log(`%c${label}%c ${message}`, badgeStyle, resetStyle);
  }
}
