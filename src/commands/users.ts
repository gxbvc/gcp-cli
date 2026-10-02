import { Command } from "commander";
import { api, projectOf } from "../lib/google.js";
import { fail, ok, requireYes } from "../lib/output.js";
import { readPayload } from "../lib/data.js";

const BASE = "https://identitytoolkit.googleapis.com/v1/projects";

// Drop password hashes and turn epoch-ms strings into ISO dates.
function clean(u: any) {
  if (!u) return u;
  const { passwordHash, salt, ...rest } = u;
  for (const k of ["createdAt", "lastLoginAt", "lastRefreshAt"]) {
    if (rest[k] && /^\d+$/.test(rest[k])) rest[k] = new Date(Number(rest[k])).toISOString();
  }
  return rest;
}

async function lookup(project: string, idOrEmail: string) {
  const body = idOrEmail.includes("@") ? { email: [idOrEmail] } : idOrEmail.startsWith("+") ? { phoneNumber: [idOrEmail] } : { localId: [idOrEmail] };
  const data: any = await api(`${BASE}/${project}/accounts:lookup`, { body, quotaProject: project });
  const user = data?.users?.[0];
  if (!user) fail(`No user found for ${idOrEmail}`, "NOT_FOUND");
  return user;
}

function common(cmd: Command) {
  return cmd.option("-p, --project <id>", "GCP/Firebase project id");
}

export function registerUsers(program: Command) {
  const users = program.command("users").description("Firebase Auth users: list, get, create, update, delete");

  common(users.command("list").description("List users"))
    .option("-l, --limit <n>", "Max users", "100")
    .action(async (opts: { project?: string; limit: string }) => {
      const project = projectOf(opts);
      const limit = Number(opts.limit);
      const out: any[] = [];
      let nextPageToken: string | undefined;
      do {
        const data: any = await api(`${BASE}/${project}/accounts:batchGet`, {
          quotaProject: project,
          params: { maxResults: Math.min(1000, limit - out.length), nextPageToken },
        });
        out.push(...(data?.users || []));
        nextPageToken = data?.nextPageToken;
      } while (nextPageToken && out.length < limit);
      ok(out.map(clean));
    });

  common(users.command("get <uidOrEmailOrPhone>").description("Get one user by uid, email, or +phone"))
    .action(async (id: string, opts: { project?: string }) => {
      ok(clean(await lookup(projectOf(opts), id)));
    });

  common(users.command("create").description("Create a user"))
    .option("--email <email>")
    .option("--password <password>")
    .option("--display-name <name>")
    .option("--phone <e164>")
    .option("--uid <uid>", "Custom uid")
    .option("--email-verified", "Mark email as verified")
    .action(async (opts: any) => {
      const project = projectOf(opts);
      const body = {
        email: opts.email,
        password: opts.password,
        displayName: opts.displayName,
        phoneNumber: opts.phone,
        localId: opts.uid,
        emailVerified: !!opts.emailVerified,
      };
      const data: any = await api(`${BASE}/${project}/accounts`, { body, quotaProject: project });
      ok(clean(await lookup(project, data.localId)));
    });

  common(users.command("update <uidOrEmail>").description("Update a user with Identity Toolkit accounts:update fields"))
    .option("-d, --data <json>", 'e.g. {"displayName":"Ann","disableUser":true,"password":"..","customAttributes":"{\\"admin\\":true}"}')
    .option("-f, --file <path>", "Read JSON from file, or - for stdin")
    .action(async (id: string, opts: { project?: string; data?: string; file?: string }) => {
      const project = projectOf(opts);
      const user = await lookup(project, id);
      const fields = readPayload(opts);
      if (fields.customAttributes && typeof fields.customAttributes !== "string") {
        fields.customAttributes = JSON.stringify(fields.customAttributes);
      }
      await api(`${BASE}/${project}/accounts:update`, { body: { ...fields, localId: user.localId }, quotaProject: project });
      ok(clean(await lookup(project, user.localId)));
    });

  common(users.command("delete <uidOrEmail>").description("Delete a user"))
    .option("-y, --yes", "Confirm the delete")
    .action(async (id: string, opts: { project?: string; yes?: boolean }) => {
      const project = projectOf(opts);
      const user = await lookup(project, id);
      requireYes(opts, `delete user ${user.email || user.localId}`);
      await api(`${BASE}/${project}/accounts:delete`, { body: { localId: user.localId }, quotaProject: project });
      ok({ deleted: clean(user) });
    });
}
