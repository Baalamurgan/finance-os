// Guard for destructive scripts (seed / import / restore). These wipe or bulk-
// write tables, so they must NEVER hit the live family DB by accident. They run
// only when ALLOW_DB_WIPE=1 is explicitly set — point DATABASE_URL at your DEV
// Supabase project first. Read-only scripts (db-backup, preview-rollover,
// ensure-month) don't need this.
export function assertDbWipeAllowed(action: string) {
  const url = process.env.DATABASE_URL ?? "";
  let host = "unknown";
  try {
    host = new URL(url.replace(/^postgres(ql)?:/, "http:")).host;
  } catch {
    /* ignore */
  }

  if (process.env.ALLOW_DB_WIPE !== "1") {
    console.error(`\n✋ "${action}" can modify/wipe the database at ${host}.`);
    console.error("   Blocked by default to protect the live family data.");
    console.error(
      "   Point DATABASE_URL at your DEV Supabase project, then re-run with ALLOW_DB_WIPE=1.\n",
    );
    process.exit(1);
  }
  console.warn(`\n⚠️  "${action}" running against ${host} (ALLOW_DB_WIPE=1).\n`);
}
