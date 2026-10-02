import { readFileSync } from "fs";
import { fail } from "./output.js";

// Read a JSON payload from --data '<json>', --file path, or --file - (stdin).
export function readPayload(opts: { data?: string; file?: string }): any {
  let raw: string | undefined;
  if (opts.data !== undefined) raw = opts.data;
  else if (opts.file === "-") raw = readFileSync(0, "utf8");
  else if (opts.file) raw = readFileSync(opts.file, "utf8");
  if (raw === undefined) fail("Pass --data '<json>' or --file <path|->", "MISSING_DATA");
  try {
    return JSON.parse(raw);
  } catch (e) {
    fail(`Invalid JSON: ${(e as Error).message}`, "BAD_JSON");
  }
}

// Parse a CLI value: JSON if it parses (numbers, true, null, "quoted", [..]), else a plain string.
export function parseValue(raw: string): any {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
