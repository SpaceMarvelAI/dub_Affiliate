import { PARTNERS_DOMAIN } from "@dub/utils";
import { NextRequest, NextResponse } from "next/server";
import { EmbedMiddleware } from "./embed";
import { NewLinkMiddleware } from "./new-link";
import { appRedirect } from "./utils/app-redirect";
import { getUserViaToken } from "./utils/get-user-via-token";
import { isTopLevelSettingsRedirect } from "./utils/is-top-level-settings-redirect";
import { parse } from "./utils/parse";
import { WorkspacesMiddleware } from "./workspaces";

export async function AppMiddleware(req: NextRequest) {
  const { path, fullPath, searchParamsString } = parse(req);

  if (path.startsWith("/embed")) {
    return EmbedMiddleware(req);
  }

  const user = await getUserViaToken(req);

  // if there's no user and the path is not a public page, redirect to /login
  if (
    !user &&
    path !== "/login" &&
    !path.startsWith("/share/") &&
    !path.startsWith("/deeplink/") &&
    !path.startsWith("/unsubscribe/")
  ) {
    return NextResponse.redirect(
      new URL(
        `/login${path === "/" ? "" : `?next=${encodeURIComponent(fullPath)}`}`,
        req.url,
      ),
    );

    // if there's a user
  } else if (user) {
    // app.dub.co is admin-only (workspace/program configuration) — everyone else belongs on partners.dub.co
    if (!user.isSuperAdmin) {
      return NextResponse.redirect(PARTNERS_DOMAIN);
    }

    // /new is a special path that creates a new link (or workspace if the user doesn't have one yet)
    if (path === "/new") {
      return NewLinkMiddleware(req, user);

      // if the path is / or /login, redirect to the default workspace
    } else if (
      [
        "/",
        "/login",
        "/workspaces",
        "/links",
        "/analytics",
        "/events",
        "/upgrade",
        "/guides",
        "/wrapped",
        "/programs",
        // here we have separate logic for the root paths instead of path.startsWith("/program")
        // because some workspace slugs are program-something which will break
        "/program",
        "/customers",
        "/settings",
      ].includes(path) ||
      path.startsWith("/program/") ||
      path.startsWith("/customers/") ||
      path.startsWith("/settings/") ||
      isTopLevelSettingsRedirect(path)
    ) {
      return WorkspacesMiddleware(req, user);
    }

    const appRedirectPath = await appRedirect(path);
    if (appRedirectPath) {
      return NextResponse.redirect(
        new URL(`${appRedirectPath}${searchParamsString}`, req.url),
      );
    }
  }

  // otherwise, rewrite the path to /app
  return NextResponse.rewrite(new URL(`/app.dub.co${fullPath}`, req.url));
}
