import * as core from "@actions/core";

import { upsertComment } from "./comment";
import { ExperimentFailure, runEval } from "./braintrust";
import type { ExperimentSummary } from "braintrust";
import { z } from "zod";

const nodeManagers = ["npm", "pnpm"];
const pythonManagers = ["pip", "uv"];
const goManagers = ["go"];
const rubyManagers = ["bundler"];
const booleanInput = z.stringbool({ truthy: ["true"], falsy: ["false"] });

export function parseReportNames(value: string) {
  return [
    ...new Set(
      value
        .split(/[\n,]/)
        .map(name => name.trim())
        .filter(Boolean),
    ),
  ];
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export const paramsSchema = z
  .strictObject({
    api_key: z.string(),
    root: z.string(),
    paths: z.string(),
    runtime: z.enum(["node", "python", "go", "ruby"]),
    package_manager: z
      .enum([
        "",
        ...nodeManagers,
        ...pythonManagers,
        ...goManagers,
        ...rubyManagers,
      ])
      .describe("The preferred package manager for the runtime selected")
      .default(""),
    use_proxy: booleanInput,
    terminate_on_failure: booleanInput.default(false),
    report_scores: z.string().transform(parseReportNames),
    report_metrics: z.string().transform(parseReportNames),
  })
  .refine(
    data => {
      if (data.package_manager === "") {
        return true;
      }
      if (data.runtime === "node") {
        return nodeManagers.includes(data.package_manager as any);
      }
      if (data.runtime === "python") {
        return pythonManagers.includes(data.package_manager as any);
      }
      if (data.runtime === "go") {
        return goManagers.includes(data.package_manager as any);
      }
      if (data.runtime === "ruby") {
        return rubyManagers.includes(data.package_manager as any);
      }
      return false;
    },
    {
      message: "Package manager must match the selected runtime",
      path: ["package_manager"], // This will show the error on the package_manager field
    },
  );
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
    package_manager: core.getInput("package_manager"),
    use_proxy: core.getInput("use_proxy"),
    terminate_on_failure: core.getInput("terminate_on_failure") || undefined,
    report_scores: core.getInput("report_scores"),
    report_metrics: core.getInput("report_metrics"),
  });
  if (!args.success) {
    throw new Error(
      `Invalid arguments: ${args.error.issues.map(e => e.message).join("\n")}`,
    );
  }

  await upsertComment(`${TITLE}Evals in progress... ⌛`);

  const reportFilters: ReportFilters = {
    scores: args.data.report_scores,
    metrics: args.data.report_metrics,
  };

  try {
    await runEval(args.data, summaries => onSummary(summaries, reportFilters));
    await runUpdateComments(true, reportFilters);
  } catch (error) {
    core.error(`Eval command failed: ${error}`);
    await upsertComment(`${TITLE}Evals failed: ${error}`);
    throw error;
  } finally {
    await currentUpdate;
  }
}

interface ReportFilters {
  scores: string[];
  metrics: string[];
}

const allSummaries: (ExperimentSummary | ExperimentFailure)[] = [];
function onSummary(
  summary: (ExperimentSummary | ExperimentFailure)[],
  reportFilters: ReportFilters,
) {
  allSummaries.push(...summary);
  runUpdateComments(false, reportFilters);
}

async function runUpdateComments(
  mustRun: boolean,
  reportFilters: ReportFilters,
) {
  queuedUpdates += 1;
  await updateComments(mustRun, reportFilters);
}

let queuedUpdates = 0;
let currentUpdate: Promise<void> = Promise.resolve();
async function updateComments(mustRun: boolean, reportFilters: ReportFilters) {
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
                reportFilters,
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
          return formatSummary(summary, reportFilters);
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

interface ReportRow {
  name: string;
  avg: string;
  improvements?: number;
  regressions?: number;
}

export function formatSummary(
  summary: ExperimentSummary,
  reportFilters: Partial<ReportFilters> = {},
) {
  const text = `**[${summary.projectName} (${summary.experimentName})](${summary.experimentUrl})**`;
  const reportScores = reportFilters.scores ?? [];
  const reportMetrics = reportFilters.metrics ?? [];

  const scoreRows = Object.entries(summary.scores ?? {})
    .filter(
      ([name]) => reportScores.length === 0 || reportScores.includes(name),
    )
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
    });

  const metricRows = Object.entries(summary.metrics ?? {})
    .filter(
      ([name]) => reportMetrics.length === 0 || reportMetrics.includes(name),
    )
    .map(([name, metricSummary]) => {
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
    });

  const table = formatResultsTable(scoreRows, metricRows);
  return table ? `${text}\n\n${table}` : text;
}

function formatResultsTable(scoreRows: ReportRow[], metricRows: ReportRow[]) {
  if (scoreRows.length === 0 && metricRows.length === 0) {
    return "";
  }

  const columns = ["Name", "Average", "Improvements", "Regressions"];
  const header = columns.join(" | ");
  // Right align the Improvements and Regressions column cells
  const separator = columns
    .map((_, idx) => (idx > 1 ? "---:" : ":---"))
    .join(" | ");
  const sections = [
    formatResultSection("Scores", scoreRows),
    formatResultSection("Metrics", metricRows),
  ].filter(Boolean);

  return `${header}\n${separator}\n${sections.join("\n")}`;
}

function formatResultSection(
  title: "Scores" | "Metrics",
  rowData: ReportRow[],
) {
  if (rowData.length === 0) {
    return "";
  }

  const rows = rowData.map(
    ({ name, avg, improvements, regressions }) =>
      `${capitalize(name)} | ${avg} | ${
        improvements !== undefined && improvements > 0
          ? `${improvements} 🟢`
          : `-`
      } | ${
        regressions !== undefined && regressions > 0 ? `${regressions} 🔴` : `-`
      }`,
  );

  return `**${title}** | | |\n${rows.join("\n")}`;
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
