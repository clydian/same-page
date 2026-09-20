import type { Context } from "hono";

import type { AppEnvironment } from "../env";
import { createAuth } from "./create-auth";

// Server-side session reads must forward renewal cookies to the browser too.
export async function readContextSession(context: Context<AppEnvironment>) {
  const { headers, response } = await createAuth(context.env, context.executionCtx).api.getSession({
    headers: context.req.raw.headers,
    returnHeaders: true,
  });
  for (const cookie of headers.getSetCookie()) {
    context.header("Set-Cookie", cookie, { append: true });
  }
  context.header("Cache-Control", "no-store");
  return response;
}
