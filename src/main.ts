import * as core from "@actions/core";
import z from "zod";

import * as util from "util";
import * as path from "path";
import { exec as execSync } from "child_process";

const exec = util.promisify(execSync);

const params = z.strictObject({
  root: z.string(),
  paths: z.string(),
  runtime: z.enum(["auto", "node", "python"])
});

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
async function main(): Promise<void> {
  const args = params.safeParse({
    root: core.getInput("root"),
    paths: core.getInput("paths"),
    runtime: core.getInput("runtime")
  });
  if (!args.success) {
    throw new Error(
      "Invalid arguments: " + args.error.errors.map(e => e.message).join("\n")
    );
  }

  const { root, paths, runtime } = args.data;

  // Change working directory
  process.chdir(path.resolve(root));

  // Run the command
  const command = `npx braintrust eval ${paths} --root ${root} --runtime ${runtime}`;
  await exec(command);
}

export async function run(): Promise<void> {
  return main().catch(error => {
    core.setFailed(error.message);
  });
}
