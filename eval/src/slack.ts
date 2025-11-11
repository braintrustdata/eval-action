import * as core from "@actions/core";
import { ExperimentSummary } from "braintrust";
import { capitalize } from "@braintrust/core";
import { ExperimentFailure } from "./braintrust";

type SlackBlock = {
  type: string;
  [key: string]: unknown;
};

type SlackMessage = {
  text: string;
  blocks: SlackBlock[];
};

type TableRow = Array<{ type: string; text?: string; elements?: unknown[] }>;

function round(n: number, decimals: number) {
  return Math.round(n * 10 ** decimals) / 10 ** decimals;
}

function createHeaderRow(): TableRow {
  return [
    { type: "raw_text", text: "Score" },
    { type: "raw_text", text: "Average" },
    { type: "raw_text", text: "Improvements" },
    { type: "raw_text", text: "Regressions" },
  ];
}

function createExperimentLinkBlock(summary: ExperimentSummary): SlackBlock {
  return {
    type: "section",
    text: {
      type: "mrkdwn",
      text: `*<${summary.experimentUrl}|${summary.projectName} (${summary.experimentName})>*`,
    },
  };
}

function createTableBlock(summary: ExperimentSummary): SlackBlock {
  const rows: TableRow[] = [createHeaderRow()];

  for (const [name, scoreSummary] of Object.entries(summary.scores)) {
    let diffText = "";
    if (scoreSummary.diff !== undefined) {
      const diffN = round(scoreSummary.diff, 2) * 100;
      diffText =
        " " + (scoreSummary.diff >= 0 ? `(+${diffN}pp)` : `(${diffN}pp)`);
    }

    const avg = `${round(scoreSummary.score * 100, 1)}%${diffText}`;
    const improvements =
      scoreSummary.improvements !== undefined && scoreSummary.improvements > 0
        ? `${scoreSummary.improvements} 🟢`
        : `-`;
    const regressions =
      scoreSummary.regressions !== undefined && scoreSummary.regressions > 0
        ? `${scoreSummary.regressions} 🔴`
        : `-`;

    rows.push([
      { type: "raw_text", text: capitalize(name) },
      { type: "raw_text", text: avg },
      { type: "raw_text", text: improvements },
      { type: "raw_text", text: regressions },
    ]);
  }

  for (const [name, metricSummary] of Object.entries(summary.metrics ?? {})) {
    let diffText = "";
    if (metricSummary.diff !== undefined) {
      const diffN = round(metricSummary.diff, 2);
      diffText =
        " " +
        (metricSummary.diff >= 0
          ? `(+${diffN}${metricSummary.unit})`
          : `(${diffN}${metricSummary.unit})`);
    }

    const avg = `${round(metricSummary.metric, 2)}${metricSummary.unit}${diffText}`;
    const improvements =
      metricSummary.improvements !== undefined && metricSummary.improvements > 0
        ? `${metricSummary.improvements} 🟢`
        : `-`;
    const regressions =
      metricSummary.regressions !== undefined && metricSummary.regressions > 0
        ? `${metricSummary.regressions} 🔴`
        : `-`;

    rows.push([
      { type: "raw_text", text: capitalize(name) },
      { type: "raw_text", text: avg },
      { type: "raw_text", text: improvements },
      { type: "raw_text", text: regressions },
    ]);
  }

  return {
    type: "table",
    rows,
    column_settings: [
      { is_wrapped: true },
      { align: "right" },
      { align: "right" },
      { align: "right" },
    ],
  };
}

function formatFailure(
  failure: ExperimentFailure,
  nextSummary?: ExperimentSummary,
): SlackBlock[] {
  const blocks: SlackBlock[] = [];

  const title = nextSummary
    ? `‼️ *<${nextSummary.experimentUrl}|${nextSummary.projectName} (${nextSummary.experimentName})>*`
    : `‼️ *${failure.evaluatorName} failed to run*`;

  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: title,
    },
  });

  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: "```\n" + failure.errors.join("\n") + "\n```",
    },
  });

  return blocks;
}

function formatSummary(summary: ExperimentSummary): SlackBlock[] {
  const blocks: SlackBlock[] = [];

  blocks.push(createExperimentLinkBlock(summary));

  const rowCount =
    Object.keys(summary.scores).length +
    Object.keys(summary.metrics ?? {}).length;
  if (rowCount > 0) {
    blocks.push(createTableBlock(summary));
  }

  return blocks;
}

function createSlackMessage(
  summaries: (ExperimentSummary | ExperimentFailure)[],
  status: "in_progress" | "completed" | "failed",
): SlackMessage {
  const blocks: SlackBlock[] = [];

  blocks.push({
    type: "header",
    text: {
      type: "plain_text",
      text: "Braintrust Eval Report",
      emoji: true,
    },
  });

  if (status === "in_progress") {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "Evals in progress... ⌛",
      },
    });
  } else if (status === "failed") {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "❌ Evals failed",
      },
    });
  } else if (summaries.length === 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "No experiments to report",
      },
    });
  } else {
    for (let idx = 0; idx < summaries.length; idx++) {
      const summary = summaries[idx];
      if (idx > 0 && "errors" in summaries[idx - 1]) {
        continue;
      }

      if (blocks.length > 1) {
        blocks.push({ type: "divider" });
      }

      if ("errors" in summary) {
        const nextSummary =
          idx < summaries.length - 1 && !("errors" in summaries[idx + 1])
            ? (summaries[idx + 1] as ExperimentSummary)
            : undefined;
        blocks.push(...formatFailure(summary, nextSummary));
      } else {
        blocks.push(...formatSummary(summary));
      }
    }
  }

  return {
    text: "Braintrust Eval Report",
    blocks,
  };
}

export async function postToSlack(
  summaries: (ExperimentSummary | ExperimentFailure)[],
  status: "in_progress" | "completed" | "failed" = "completed",
): Promise<void> {
  const webhookUrl = core.getInput("slack_webhook_url");

  if (!webhookUrl || webhookUrl === "") {
    core.info("No Slack webhook URL provided, skipping Slack notification");
    return;
  }

  try {
    const message = createSlackMessage(summaries, status);

    core.debug(`Posting to Slack: ${JSON.stringify(message, null, 2)}`);

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      const errorText = await response.text();
      core.warning(
        `Failed to post to Slack: ${response.status} ${response.statusText} - ${errorText}`,
      );
      return;
    }

    core.info("Successfully posted evaluation results to Slack");
  } catch (error) {
    core.warning(`Error posting to Slack: ${error}`);
  }
}
