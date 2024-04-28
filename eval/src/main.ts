import * as core from "@actions/core";
import z from "zod";

import { upsertComment } from "./comment";
import { runEval } from "./braintrust";
import { Experiment, ExperimentSummary } from "braintrust";

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

  await upsertComment("Evals in progress...");

  const summaries = await runEval(args.data, onSummary);
  core.info("Eval complete " + JSON.stringify(summaries, null, 2));
}

const allSummaries: ExperimentSummary[] = [];
function onSummary(summary: ExperimentSummary) {
  allSummaries.push(summary);

  queuedUpdates += 1;
  updateComments();
}

let queuedUpdates = 0;
async function updateComments() {
  if (queuedUpdates > 1) {
    return;
  }

  await upsertComment(
    allSummaries
      .map((summary: ExperimentSummary) => {
        const text = `## [${summary.experimentName}](${summary.experimentUrl})`;
        return text;
      })
      .join("\n"),
  );
  queuedUpdates -= 1;
  if (queuedUpdates > 0) {
    updateComments();
  }
}

export async function run(): Promise<void> {
  return main().catch(error => {
    core.setFailed(error.message);
  });
}
