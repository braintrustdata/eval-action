import path from "path";
import * as core from "@actions/core";
import { spawn } from "child_process";

import { Params } from "./main";
import type { ExperimentSummary } from "braintrust";

export interface ExperimentFailure {
  evaluatorName: string;
  errors: string[];
}

type OnSummaryFn = (summary: (ExperimentSummary | ExperimentFailure)[]) => void;

function snakeToCamelCase(str: string) {
  return str.replace(/([-_][a-z])/g, group => group.charAt(1).toUpperCase());
}

const summaryKeyMap: Record<string, string> = {
  ProjectName: "projectName",
  ExperimentName: "experimentName",
  ProjectID: "projectId",
  projectID: "projectId",
  ExperimentID: "experimentId",
  experimentID: "experimentId",
  ProjectURL: "projectUrl",
  projectURL: "projectUrl",
  ExperimentURL: "experimentUrl",
  experimentURL: "experimentUrl",
  ComparisonExperimentName: "comparisonExperimentName",
  Scores: "scores",
  Metrics: "metrics",
  EvaluatorName: "evaluatorName",
  Errors: "errors",
};

function normalizeSummaryKeys(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      summaryKeyMap[key] ?? snakeToCamelCase(key),
      entry,
    ]),
  );
}

function parseSummaryLine(line: string) {
  try {
    const parsedLine = JSON.parse(line) as unknown;
    if (
      parsedLine === null ||
      typeof parsedLine !== "object" ||
      Array.isArray(parsedLine)
    ) {
      core.info(line);
      return [];
    }

    // TODO: This is hacky and we should be parsing what comes off the wire.
    // The JS/Python CLI emits snake_case JSONL while the Go SDK's
    // ExperimentSummary marshals top-level fields as PascalCase.
    const summary = normalizeSummaryKeys(parsedLine as Record<string, unknown>);
    if (
      ("errors" in summary && "evaluatorName" in summary) ||
      ("experimentName" in summary &&
        ("scores" in summary || "metrics" in summary))
    ) {
      return [summary as unknown as ExperimentSummary];
    }

    core.info(line);
    return [];
  } catch (e) {
    if (line.startsWith("{") || line.startsWith("[")) {
      core.error(`Failed to parse jsonl data: ${e}`);
    } else {
      core.info(line);
    }
    return [];
  }
}

async function runCommand(command: string, onSummary: OnSummaryFn) {
  core.info(`> $ ${command}`);
  return new Promise((resolve, reject) => {
    const process = spawn(command, { shell: true });
    let stdoutBuffer = "";

    const handleStdoutLine = (line: string) => {
      const trimmedLine = line.trim();
      if (trimmedLine.length === 0) {
        return;
      }
      const summaries = parseSummaryLine(trimmedLine);
      if (summaries.length > 0) {
        onSummary(summaries);
      }
    };

    process.stdout?.on("data", (data: Buffer) => {
      stdoutBuffer += data.toString();
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() ?? "";
      lines.forEach(handleStdoutLine);
    });

    process.stderr?.on("data", (data: Buffer) => {
      core.info(data.toString()); // Outputs the stderr of the command
    });

    process.on("close", code => {
      if (stdoutBuffer.length > 0) {
        handleStdoutLine(stdoutBuffer);
        stdoutBuffer = "";
      }

      if (code === 0) {
        resolve(null);
      } else {
        reject(new Error(`Command failed with exit code ${code}`));
      }
    });
  });
}

export async function runEval(args: Params, onSummary: OnSummaryFn) {
  const { api_key, root, paths, terminate_on_failure } = args;

  // Add the API key to the environment
  core.exportVariable("BRAINTRUST_API_KEY", api_key);

  if (!process.env.OPENAI_API_KEY) {
    core.exportVariable("OPENAI_API_KEY", api_key);
  }

  if (args.use_proxy) {
    core.exportVariable("OPENAI_BASE_URL", "https://braintrustproxy.com/v1");
  }

  // Change working directory
  process.chdir(path.resolve(root));

  const terminateFlag = terminate_on_failure ? "--terminate-on-failure" : "";

  const command = (() => {
    switch (args.runtime.toLowerCase().trim()) {
      case "node": {
        const baseCommand = (() => {
          switch (args.package_manager) {
            case "":
            case "npm":
              return "npx braintrust";
            case "pnpm":
              return "pnpm dlx braintrust";
            default:
              throw new Error(
                `Unsupported package manager: ${args.package_manager}`,
              );
          }
        })();
        return `${baseCommand} eval --jsonl ${terminateFlag} ${paths}`;
      }
      case "python": {
        const baseCommand = (() => {
          switch ((args.package_manager || "").toLowerCase().trim()) {
            case "":
            case "pip":
              return `braintrust`;
            case "uv":
              return `uv run braintrust`;
            default:
              throw new Error(
                `Unsupported package manager: ${args.package_manager}`,
              );
          }
        })();
        return `${baseCommand} eval --jsonl ${terminateFlag} ${paths}`;
      }
      case "go":
        switch ((args.package_manager || "").toLowerCase().trim()) {
          case "":
          case "go":
            if (terminate_on_failure) {
              core.info("Ignoring terminate_on_failure for Go evals");
            }
            return `go run ${paths}`;
          default:
            throw new Error(
              `Unsupported package manager: ${args.package_manager}`,
            );
        }
      default:
        throw new Error(`Unsupported runtime: ${args.runtime}`);
    }
  })();

  await runCommand(command, onSummary);
}
