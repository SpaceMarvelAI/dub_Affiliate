"use client";

import { authDebug } from "@/lib/auth/debug-log";
import { Button } from "@dub/ui";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export const errorCodes = {
  OAuthSignin:
    "There was an issue signing you in. Please ensure your provider settings are correct.",
  OAuthCallback:
    "We faced a problem while processing the response from the OAuth provider. Please try again.",
  OAuthAccountNotLinked:
    "It looks like you already have an account with this email. Please sign in with your account email instead.",
  Callback:
    "We encountered an issue processing your request. Please try again or contact support if the problem persists.",
};

export default function LoginForm({ next }: { next?: string }) {
  const searchParams = useSearchParams();
  const [clicked, setClicked] = useState(false);

  useEffect(() => {
    const error = searchParams?.get("error");
    if (error) {
      authDebug("error", `OAuth sign-in failed: ${error}`, {
        error,
        allParams: Object.fromEntries(searchParams?.entries() ?? []),
        shownToUser: errorCodes[error] ?? "An unexpected error occurred.",
        hint: "Full detail (bad client_id/secret, discovery fetch failure, etc.) is in the server console, not here — this browser only ever sees the error code on the redirect URL.",
      });
      toast.error(
        errorCodes[error] ||
          "An unexpected error occurred. Please try again later.",
      );
    }
  }, [searchParams]);

  return (
    <Button
      text="Continue with SpaceMarvel"
      loading={clicked}
      onClick={() => {
        setClicked(true);
        authDebug("client", "Continue with SpaceMarvel clicked", {
          provider: "spacemarvel",
          callbackUrl: next ?? "(default)",
        });
        signIn("spacemarvel", {
          ...(next && { callbackUrl: next }),
        });
      }}
    />
  );
}
