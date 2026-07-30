// Tiny structured logger for server actions / route handlers. Emits one JSON line per event so
// Vercel Runtime Logs (and any log drain) stay filterable: search by `tag`, `outcome`, `memberId`,
// etc. Use `outcome: "ok" | "blocked" | "error"` so successes and failures are both visible —
// silent `return`s in an action are invisible in prod, which is exactly what bit us.
type Fields = Record<string, unknown>;

function emit(level: "info" | "warn" | "error", tag: string, event: string, fields: Fields) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, tag, event, ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (tag: string, event: string, fields: Fields = {}) => emit("info", tag, event, fields),
  warn: (tag: string, event: string, fields: Fields = {}) => emit("warn", tag, event, fields),
  error: (tag: string, event: string, fields: Fields = {}) => emit("error", tag, event, fields),
};
