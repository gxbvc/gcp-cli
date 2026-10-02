import { Command } from "commander";
import "./config.js";
import { fail } from "./lib/output.js";
import { registerProjects } from "./commands/projects.js";
import { registerInventory } from "./commands/inventory.js";
import { registerFirestore } from "./commands/firestore.js";
import { registerUsers } from "./commands/users.js";
import { registerPassthrough } from "./commands/passthrough.js";

const program = new Command();

program
  .name("gcp-cli")
  .description("Google Cloud and Firebase for agents: projects, inventory, Firestore docs, Auth users, plus gcloud/firebase passthrough")
  .version("1.0.0");

registerProjects(program);
registerInventory(program);
registerFirestore(program);
registerUsers(program);
registerPassthrough(program);

program.parseAsync().catch((err) => fail(err));
