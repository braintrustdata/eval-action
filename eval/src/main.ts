import * as core from "@actions/core";
import z from "zod";

import * as util from "util";
import * as path from "path";
import * as os from "os";
import * as fs from "fs/promises";
import { exec as execSync } from "child_process";

import { upsertComment } from "./comment";
import { runEval } from "./braintrust";

const exec = util.promisify(execSync);

const paramsSchema = z.strictObject({
  api_key: z.string(),
  root: z.string(),
  paths: z.string(),
  runtime: z.enum(["auto", "node", "python"]),
});
export type Params = z.infer<typeof paramsSchema>;

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
async function main(): Promise<void> {
  const args = paramsSchema.safeParse({
    api_key: core.getInput("api_key"),
    root: core.getInput("root"),
    paths: core.getInput("paths"),
    runtime: core.getInput("runtime"),
  });
  if (!args.success) {
    throw new Error(
      "Invalid arguments: " + args.error.errors.map(e => e.message).join("\n"),
    );
  }

  const summaries = await runEval(args.data);
  core.info("Eval complete " + JSON.stringify(summaries, null, 2));

  await upsertComment();
}

export async function run(): Promise<void> {
  return main().catch(error => {
    core.setFailed(error.message);
  });
}
