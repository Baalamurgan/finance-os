import { log } from "@/lib/log";

// Next.js calls this for EVERY unhandled error thrown anywhere on the server — server actions,
// server components, route handlers. So any unexpected bug (a failed query, a null deref, a
// thrown API error) shows up in Vercel Runtime Logs as one structured line, with the request
// path and route, without us having to wrap each action. Expected control-flow throws
// (redirect / notFound) are filtered out so they don't look like errors.
type ErrLike = { message?: string; digest?: string; stack?: string };
type ReqLike = { path?: string; method?: string };
type CtxLike = { routerKind?: string; routePath?: string; routeType?: string; renderSource?: string };

export function onRequestError(err: unknown, request: ReqLike, context: CtxLike) {
  const e = (err ?? {}) as ErrLike;
  const digest = typeof e.digest === "string" ? e.digest : undefined;
  if (digest && (digest.startsWith("NEXT_REDIRECT") || digest === "NEXT_HTTP_ERROR_FALLBACK;404")) return;

  log.error("request", "unhandled", {
    outcome: "error",
    message: e.message ?? String(err),
    path: request?.path,
    method: request?.method,
    route: context?.routePath,
    routeType: context?.routeType,
    digest,
    stack: e.stack?.split("\n").slice(0, 4).join(" | "),
  });
}
