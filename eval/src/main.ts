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
      `Invalid arguments: ${args.error.errors.map(e => e.message).join("\n")}`,
    );
  }
  if (args.data.runtime !== "node") {
    throw new Error("Only Node.js runtime is supported");
  }

  await upsertComment("Evals in progress... ⌛");

  try {
    await runEval(args.data, onSummary);
    await updateComments(true);
  } catch (error) {
    core.error(`${error}`);
    throw error;
  } finally {
    await currentUpdate;
  }
}

const allSummaries: (ExperimentSummary | ExperimentFailure)[] = [];
function onSummary(summary: (ExperimentSummary | ExperimentFailure)[]) {
  allSummaries.push(...summary);
  runUpdateComments();
}

function runUpdateComments() {
  queuedUpdates += 1;
  updateComments(false);
}

let queuedUpdates = 0;
let currentUpdate: Promise<void> = Promise.resolve();
async function updateComments(mustRun: boolean) {
  if (queuedUpdates > 1 && !mustRun) {
    return;
  }

  currentUpdate = (async () => {
    while (queuedUpdates > 0) {
      await upsertComment(
        "## Braintrust eval report\n" +
          allSummaries
            .map((summary: ExperimentSummary | ExperimentFailure, idx) => {
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
            })
            .join("\n\n"),
      );
      queuedUpdates -= 1;
    }
  })();
  await currentUpdate;
}

function formatSummary(summary: ExperimentSummary) {
  const text = `**[${summary.projectName} (${summary.experimentName})](${summary.experimentUrl})**`;
  const columns = ["Score", "Average", "Improvements", "Regressions"];
  const header = columns.join(" | ");
  const separator = columns.map(() => "---").join(" | ");

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
        avg: `${round(scoreSummary.score, 2)}${diffText}`,
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
          ? `🟢 ${improvements}`
          : `🟡`
      } | ${
        regressions !== undefined && regressions > 0
          ? `🔴 ${regressions}`
          : `🟡`
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
