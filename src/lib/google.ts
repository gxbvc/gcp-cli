import { GoogleAuth } from "google-auth-library";
import { DEFAULT_PROJECT, KEY_FILE, QUOTA_PROJECT } from "../config.js";
import { fail } from "./output.js";

export const auth = new GoogleAuth({
  keyFile: KEY_FILE,
  scopes: [
    "https://www.googleapis.com/auth/cloud-platform",
    "https://www.googleapis.com/auth/firebase",
  ],
});

export function projectOf(opts: { project?: string }): string {
  const project = opts.project || DEFAULT_PROJECT;
  if (!project) fail("--project is required (or set GCP_DEFAULT_PROJECT in .env)", "MISSING_PROJECT");
  return project;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// Call a Google REST API. `quotaProject` sends x-goog-user-project, which some
// APIs (Identity Toolkit, Service Usage) need when you use your own login.
export async function api<T = any>(
  url: string,
  opts: { method?: string; body?: unknown; quotaProject?: string; params?: Record<string, string | number | undefined> } = {},
): Promise<T> {
  const client = await auth.getClient();
  const u = new URL(url);
  for (const [k, v] of Object.entries(opts.params || {})) if (v !== undefined) u.searchParams.set(k, String(v));
  const headers: Record<string, string> = {};
  const quotaProject = opts.quotaProject || (KEY_FILE ? undefined : QUOTA_PROJECT);
  if (quotaProject) headers["x-goog-user-project"] = quotaProject;
  try {
    const res = await client.request<T>({
      url: u.toString(),
      method: (opts.method || (opts.body ? "POST" : "GET")) as any,
      data: opts.body,
      headers,
    });
    return res.data;
  } catch (e: any) {
    const status = e?.response?.status ?? 0;
    const msg = e?.response?.data?.error?.message || e?.message || String(e);
    // Old projects often have the API (or Service Usage) turned off. Bill the
    // call to GCP_QUOTA_PROJECT instead of turning anything on in the target.
    const retryable = status === 403 && /has not been used in project|is disabled|serviceUsageConsumer/.test(msg);
    if (retryable && !KEY_FILE && QUOTA_PROJECT && opts.quotaProject && opts.quotaProject !== QUOTA_PROJECT) {
      return api<T>(url, { ...opts, quotaProject: QUOTA_PROJECT });
    }
    throw new ApiError(status, msg);
  }
}

// Follow nextPageToken until done or `max` items are collected.
export async function paged<T>(
  url: string,
  key: string,
  opts: { params?: Record<string, string | number | undefined>; quotaProject?: string; max?: number } = {},
): Promise<T[]> {
  const out: T[] = [];
  let pageToken: string | undefined;
  do {
    const data: any = await api(url, { quotaProject: opts.quotaProject, params: { ...opts.params, pageToken } });
    out.push(...(data?.[key] || []));
    pageToken = data?.nextPageToken;
  } while (pageToken && (!opts.max || out.length < opts.max));
  return opts.max ? out.slice(0, opts.max) : out;
}
