import * as core from "@actions/core";
import z from "zod";

import { upsertComment } from "./comment";
import { ExperimentFailure, runEval } from "./braintrust";
import { ExperimentSummary } from "braintrust";
import { capitalize } from "@braintrust/core";

const paramsSchema = z.strictObject({
  api_key: z.string(),
  root: z.string(),
  paths: z.string(),
  runtime: z.enum(["node", "python"]),
  use_proxy: z
    .string()
    .toLowerCase()
    .transform(x => JSON.parse(x))
    .pipe(z.boolean()),
});
export type Params = z.infer<typeof paramsSchema>;

const TITLE = "## Braintrust eval report\n";

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
    use_proxy: core.getInput("use_proxy"),
  });
  if (!args.success) {
    throw new Error(
      `Invalid arguments: ${args.error.errors.map(e => e.message).join("\n")}`,
    );
  }
  if (args.data.runtime !== "node") {
    throw new Error("Only Node.js runtime is supported");
  }

  await upsertComment(`${TITLE}Evals in progress... ⌛`);

  try {
    await runEval(args.data, onSummary);
    await runUpdateComments(true);
  } catch (error) {
    core.error(`Eval command failed: ${error}`);
    await upsertComment(`${TITLE}Evals failed: ${error}`);
    throw error;
  } finally {
    await currentUpdate;
  }
}

const allSummaries: (ExperimentSummary | ExperimentFailure)[] = [];
function onSummary(summary: (ExperimentSummary | ExperimentFailure)[]) {
  allSummaries.push(...summary);
  runUpdateComments(false);
}

async function runUpdateComments(mustRun: boolean) {
  queuedUpdates += 1;
  await updateComments(mustRun);
}

let queuedUpdates = 0;
let currentUpdate: Promise<void> = Promise.resolve();
async function updateComments(mustRun: boolean) {
  if (queuedUpdates > 1 && !mustRun) {
    return;
  }

  currentUpdate = (async () => {
    while (queuedUpdates > 0) {
      const summaryTables = allSummaries.map(
        (summary: ExperimentSummary | ExperimentFailure, idx) => {
          // As a somewhat ridiculous hack, we know that we _first_ print errors, and then the summary,
          // for experiments that fail.
          if (idx > 0 && "errors" in allSummaries[idx - 1]) {
            return "";
          }
          if ("errors" in summary) {
            let prefix = "**‼️** ";
            if (
              idx < allSummaries.length - 1 &&
              !("errors" in allSummaries[idx + 1])
            ) {
              prefix += formatSummary(
                allSummaries[idx + 1] as ExperimentSummary,
              );
            } else {
              prefix += `**${summary.evaluatorName} failed to run**`;
            }
            const errors = "```\n" + summary.errors.join("\n") + "\n```";
            return (
              prefix +
              "\n" +
              `<details>
<summary>Expand to see errors</summary>

${errors}              

</details>`
            );
          }
          return formatSummary(summary);
        },
      );
      const comment =
        TITLE +
        (summaryTables.length > 0
          ? summaryTables.join("\n\n")
          : "No experiments to report");
      await upsertComment(comment);
      queuedUpdates -= 1;
    }
  })();
  await currentUpdate;
}

function formatSummary(summary: ExperimentSummary) {
  const text = `**[${summary.projectName} (${summary.experimentName})](${summary.experimentUrl})**`;
  const columns = ["Score", "Average", "Improvements", "Regressions"];
  const header = columns.join(" | ");
  // Right align the Improvements and Regressions column cells
  const separator = columns.map((_, idx) => idx > 1 ? "---:" : ":---").join(" | ");

  const rowData = Object.entries(summary.scores)
    .map(([name, scoreSummary]) => {
      let diffText = "";
      if (scoreSummary.diff !== undefined) {
        const diffN = round(scoreSummary.diff, 2) * 100;
        diffText =
          " " + (scoreSummary.diff >= 0 ? `(+${diffN}pp)` : `(${diffN}pp)`);
      }

      return {
        name,
        avg: `${round(scoreSummary.score * 100, 1)}%${diffText}`,
        improvements: scoreSummary.improvements,
        regressions: scoreSummary.regressions,
      };
    })
    .concat(
      Object.entries(summary.metrics ?? {}).map(([name, metricSummary]) => {
        let diffText = "";
        if (metricSummary.diff !== undefined) {
          const diffN = round(metricSummary.diff, 2);
          diffText =
            " " +
            (metricSummary.diff >= 0
              ? `(+${diffN}${metricSummary.unit})`
              : `(${diffN}${metricSummary.unit})`);
        }
        return {
          name,
          avg: `${round(metricSummary.metric, 2)}${metricSummary.unit}${diffText}`,
          improvements: metricSummary.improvements,
          regressions: metricSummary.regressions,
        };
      }),
    );

  if (rowData.length === 0) {
    return text;
  }

  const rows = rowData.map(
    ({ name, avg, improvements, regressions }) =>
      `${capitalize(name)} | ${avg} | ${
        improvements !== undefined && improvements > 0
          ? `${improvements} 🟢`
          : `-`
      } | ${
        regressions !== undefined && regressions > 0
          ? `${regressions} 🔴`
          : `-`
      }`,
  );
  return `${text}\n${header}\n${separator}\n${rows.join("\n")}`;
}

function round(n: number, decimals: number) {
  return Math.round(n * 10 ** decimals) / 10 ** decimals;
}

export async function run(): Promise<void> {
  try {
    await main();
  } catch (error) {
    core.setFailed(`${error}`);
  }
}
