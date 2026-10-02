import { Command } from "commander";
import { spawnSync } from "child_process";
import { KEY_FILE, QUOTA_PROJECT } from "../config.js";

// Run the official CLI with the same identity gcp-cli uses.
function run(bin: string, args: string[]) {
  const env = { ...process.env };
  if (KEY_FILE && bin === "gcloud") env.CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE = KEY_FILE;
  // firebase-tools on a user login (no `firebase login`) falls back to ADC,
  // which needs a quota project for the Firebase Management API.
  if (!KEY_FILE && QUOTA_PROJECT && !env.GOOGLE_CLOUD_QUOTA_PROJECT) env.GOOGLE_CLOUD_QUOTA_PROJECT = QUOTA_PROJECT;
  const res = spawnSync(bin, args, { stdio: "inherit", env });
  if (res.error) {
    console.error(`Could not run ${bin}: ${res.error.message}`);
    process.exit(1);
  }
  process.exit(res.status ?? 1);
}

export function registerPassthrough(program: Command) {
  program
    .command("gcloud")
    .description("Run gcloud with gcp-cli's identity, e.g. gcp-cli gcloud run services list --project X --format=json")
    .allowUnknownOption()
    .helpOption(false)
    .argument("[args...]")
    .action((args: string[]) => run("gcloud", args));

  program
    .command("firebase")
    .description("Run firebase-tools, e.g. gcp-cli firebase hosting:sites:list --project X --json")
    .allowUnknownOption()
    .helpOption(false)
    .argument("[args...]")
    .action((args: string[]) => run("firebase", args));
}
