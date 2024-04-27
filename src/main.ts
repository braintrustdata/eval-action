import * as core from "@actions/core";
import z from "zod";

import * as util from "util";
import * as path from "path";
import { exec as execSync } from "child_process";

const exec = util.promisify(execSync);

const params = z.strictObject({
  api_key: z.string(),
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
    api_key: core.getInput("api_key"),
    root: core.getInput("root"),
    paths: core.getInput("paths"),
    runtime: core.getInput("runtime")
  });
  if (!args.success) {
    throw new Error(
      "Invalid arguments: " + args.error.errors.map(e => e.message).join("\n")
    );
  }

  const { api_key, root, paths, runtime } = args.data;

  // Add the API key to the environment
  core.exportVariable("BRAINTRUST_API_KEY", api_key);

  // Change working directory
  process.chdir(path.resolve(root));

  // Run the command
  const command = `npx braintrust eval ${paths}`;
  await exec(command);
}

export async function run(): Promise<void> {
  return main().catch(error => {
    core.setFailed(error.message);
  });
}
