"use client";

import { authDebug } from "@/lib/auth/debug-log";
import { Button, Input } from "@dub/ui";
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
  const [clicked, setClicked] = useState<"google" | null>(null);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

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

  const submitPassword = async () => {
    setSubmitting(true);
    try {
      const res = await fetch(
        mode === "login" ? "/api/auth/login-password" : "/api/auth/signup",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Something went wrong.");
        return;
      }
      window.location.href = next || "/";
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Button
        text="Continue with Google"
        loading={clicked === "google"}
        disabled={clicked !== null}
        onClick={() => {
          setClicked("google");
          authDebug("client", "Continue with Google clicked", {
            provider: "google",
            callbackUrl: next ?? "(default)",
          });
          window.location.href = next
            ? `/api/auth/google/login?next=${encodeURIComponent(next)}`
            : "/api/auth/google/login";
        }}
      />

      <div className="flex items-center gap-3 text-xs text-neutral-400">
        <div className="h-px flex-1 bg-neutral-200" />
        or
        <div className="h-px flex-1 bg-neutral-200" />
      </div>

      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          submitPassword();
        }}
      >
        <Input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
        />
        <Button
          text={mode === "login" ? "Log in" : "Sign up"}
          variant="secondary"
          type="submit"
          loading={submitting}
          disabled={clicked !== null}
        />
      </form>

      <button
        type="button"
        className="text-center text-sm text-neutral-500 hover:text-neutral-800"
        onClick={() => setMode(mode === "login" ? "signup" : "login")}
      >
        {mode === "login"
          ? "Don't have an account? Sign up"
          : "Already have an account? Log in"}
      </button>
    </div>
  );
}
