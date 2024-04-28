import * as core from "@actions/core";
import z from "zod";

import { upsertComment } from "./comment";
import { runEval } from "./braintrust";
import { ExperimentSummary } from "braintrust";
import { capitalize } from "@braintrust/core";

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

  try {
    await runEval(args.data, onSummary);
    runUpdateComments();
  } catch (error) {
    upsertComment("‼️ Evals failed to run");
    throw error;
  }
}

const allSummaries: ExperimentSummary[] = [];
function onSummary(summary: ExperimentSummary[]) {
  allSummaries.push(...summary);
  runUpdateComments();
}

function runUpdateComments() {
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
        const text = `**[${summary.projectName} (${summary.experimentName})](${summary.experimentUrl})**`;
        const columns = ["Score", "Average", "Improvements", "Regressions"];
        const header = columns.join(" | ");
        const separator = columns.map(() => "---").join(" | ");

        const rowData = Object.entries(summary.scores)
          .map(([name, summary]) => {
            let diffText = "";
            if (summary.diff !== undefined) {
              const diffN = round(summary.diff, 2) * 100;
              diffText =
                " " + (summary.diff > 0 ? `(+${diffN}pp)` : `(${diffN}pp)`);
            }

            return {
              name,
              avg: `${round(summary.score, 2)}${diffText}`,
              improvements: summary.improvements,
              regressions: summary.regressions,
            };
          })
          .concat(
            Object.entries(summary.metrics ?? {}).map(([name, summary]) => {
              let diffText = "";
              if (summary.diff !== undefined) {
                const diffN = round(summary.diff, 2);
                diffText =
                  " " +
                  (summary.diff > 0
                    ? `(+${diffN}${summary.unit})`
                    : `(${diffN}${summary.unit})`);
              }
              return {
                name,
                avg: `${round(summary.metric, 2)}${summary.unit}${diffText}`,
                improvements: summary.improvements,
                regressions: summary.regressions,
              };
            }),
          );

        const rows = rowData.map(
          ({ name, avg, improvements, regressions }) =>
            `${capitalize(name)} | ${avg} | ${
              improvements !== undefined && improvements > 0
                ? `🟢 ${improvements}`
                : `🟡`
            } | ${
              regressions !== undefined && regressions > 0
                ? `🔴 ${regressions}`
                : `🟡`
            }`,
        );
        return `${text}\n${header}\n${separator}\n${rows.join("\n")}`;
      })
      .join("\n\n"),
  );
  queuedUpdates -= 1;
  if (queuedUpdates > 0) {
    updateComments();
  }
}

function round(n: number, decimals: number) {
  return Math.round(n * 10 ** decimals) / 10 ** decimals;
}

export async function run(): Promise<void> {
  return main().catch(error => {
    core.setFailed(error.message);
  });
}
