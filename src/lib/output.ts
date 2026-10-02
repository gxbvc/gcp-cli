export function ok(data: unknown): void {
  process.stdout.write(JSON.stringify({ ok: true, data }) + "\n");
}

export function fail(error: unknown, code = "ERROR"): never {
  const message = error instanceof Error ? error.message : String(error);
  process.stdout.write(JSON.stringify({ ok: false, error: message, code }) + "\n");
  process.exit(1);
}

export function requireYes(opts: { yes?: boolean }, what: string): void {
  if (!opts.yes) fail(`Refusing to ${what} without --yes`, "CONFIRM_REQUIRED");
}
