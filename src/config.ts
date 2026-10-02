import { config } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", ".env"), quiet: true });

// Optional. Path to a service account key. When unset, the tool uses your own
// login (Application Default Credentials from `gcloud auth application-default login`).
export const KEY_FILE = process.env.GOOGLE_APPLICATION_CREDENTIALS || undefined;

// Optional default for --project.
export const DEFAULT_PROJECT = process.env.GCP_DEFAULT_PROJECT || undefined;

// Project billed for API quota on calls that are not tied to one project
// (list projects, list Firebase projects). Only used with your own login.
export const QUOTA_PROJECT = process.env.GCP_QUOTA_PROJECT || undefined;
