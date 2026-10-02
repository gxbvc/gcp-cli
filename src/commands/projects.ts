import { Command } from "commander";
import { paged } from "../lib/google.js";
import { ok } from "../lib/output.js";

export async function listProjects(opts: { all?: boolean } = {}) {
  const [projects, firebase] = await Promise.all([
    paged<any>("https://cloudresourcemanager.googleapis.com/v1/projects", "projects", { params: { pageSize: 500 } }),
    paged<any>("https://firebase.googleapis.com/v1beta1/projects", "results", { params: { pageSize: 100 } }).catch(() => []),
  ]);
  const fbIds = new Set(firebase.map((p: any) => p.projectId));
  return projects
    .filter((p) => opts.all || p.lifecycleState === "ACTIVE")
    .map((p) => ({
      projectId: p.projectId,
      name: p.name,
      number: p.projectNumber,
      state: p.lifecycleState,
      createTime: p.createTime,
      firebase: fbIds.has(p.projectId),
      parent: p.parent ? `${p.parent.type}/${p.parent.id}` : null,
    }))
    .sort((a, b) => (a.createTime < b.createTime ? 1 : -1));
}

export function registerProjects(program: Command) {
  program
    .command("projects")
    .description("List projects you can see, newest first, with a Firebase flag")
    .option("--all", "Include projects pending deletion")
    .action(async (opts) => ok(await listProjects(opts)));
}
