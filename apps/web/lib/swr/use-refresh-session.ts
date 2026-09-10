import { useSession } from "next-auth/react";
import { useEffect, useRef } from "react";

export default function useRefreshSession(sessionUserAttribute: string) {
  const { data: session, update, status } = useSession();
  // update() re-fetches the session but can't invent an attribute that
  // genuinely isn't set (e.g. a brand-new signup with no partner profile
  // yet) — calling it every time `session` changes, including in response
  // to its own re-fetch, retries forever. One attempt per session is enough:
  // if the attribute really does show up shortly after (server-side
  // provisioning finishing), it'll be there on the one retry; if not, the
  // caller's own "no profile" fallback (e.g. redirect to /onboarding) is
  // what's supposed to handle it, not an endless loop here.
  const hasRetried = useRef(false);

  useEffect(() => {
    const refreshSession = async () => {
      if (session?.user && !session.user[sessionUserAttribute] && !hasRetried.current) {
        hasRetried.current = true;
        console.log(`no ${sessionUserAttribute}, refreshing`);
        await update();
      }
    };
    refreshSession();
  }, [session]);

  return {
    session,
    update,
    loading: status === "loading",
  };
}
