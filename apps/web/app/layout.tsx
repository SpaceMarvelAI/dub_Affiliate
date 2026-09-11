import { geistMono, inter, satoshi } from "@/styles/fonts";
import "@/styles/globals.css";
import { cn, constructMetadata } from "@dub/utils";
import Script from "next/script";
import RootProviders from "./providers";

export const metadata = constructMetadata();

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={cn(satoshi.variable, inter.variable, geistMono.variable)}
    >
      {/* suppressHydrationWarning here (not a blanket app-wide setting) is
          the standard, official fix for browser extensions (ColorZilla,
          Grammarly, etc.) injecting attributes like cz-shortcut-listen onto
          <body> before React hydrates — a client-side DOM change outside
          the app's control, not a real markup mismatch. It only silences
          warnings for attribute differences on this one element. */}
      <body suppressHydrationWarning>
        <RootProviders>{children}</RootProviders>

        <Script id="set-theme" strategy="beforeInteractive">
          {`
          (() => {
            // Only run on referrals embed page for now
            if (window.location.pathname !== '/embed/referrals') return;

            const urlParams = new URLSearchParams(window.location.search);
            const theme = urlParams.get('theme');

            if (theme === 'dark' || (theme === 'system' && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
              document.body.classList.add("dark");
            } else {
              document.body.classList.remove("dark");
            }
          })();
        `}
        </Script>
      </body>
    </html>
  );
}
