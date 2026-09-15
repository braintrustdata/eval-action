import path from "path";
import fs from "fs";
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

function omitNullDiffs(summary: Record<string, unknown>) {
  for (const sectionName of ["scores", "metrics"]) {
    const section = summary[sectionName];
    if (
      section === null ||
      typeof section !== "object" ||
      Array.isArray(section)
    ) {
      continue;
    }
    for (const value of Object.values(section)) {
      if (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        (value as Record<string, unknown>).diff === null
      ) {
        delete (value as Record<string, unknown>).diff;
      }
    }
  }
  return summary;
}

export function parseSummaryLine(line: string) {
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
    const summary = omitNullDiffs(
      normalizeSummaryKeys(parsedLine as Record<string, unknown>),
    );
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

export interface EvalCommand {
  command: string;
  args?: string[];
  shell?: boolean;
  display: string;
}

export async function runCommand(
  command: EvalCommand,
  cwd: string,
  onSummary: OnSummaryFn,
) {
  core.info(`> $ ${command.display}`);
  return new Promise((resolve, reject) => {
    const child = spawn(command.command, command.args ?? [], {
      cwd,
      shell: command.shell ?? false,
    });
    let stdoutBuffer = "";
    let settled = false;

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

    child.stdout?.on("data", (data: Buffer) => {
      stdoutBuffer += data.toString();
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() ?? "";
      lines.forEach(handleStdoutLine);
    });

    child.stderr?.on("data", (data: Buffer) => {
      core.info(data.toString()); // Outputs the stderr of the command
    });

    child.on("error", error => {
      if (!settled) {
        settled = true;
        const hint =
          command.command === "bundle"
            ? " Ensure Bundler is installed and available on PATH."
            : command.command === "ruby"
              ? " Ensure Ruby is installed and available on PATH."
              : "";
        reject(
          new Error(
            `Failed to start ${command.command}: ${error.message}.${hint}`,
          ),
        );
      }
    });

    child.on("close", code => {
      if (stdoutBuffer.length > 0) {
        handleStdoutLine(stdoutBuffer);
        stdoutBuffer = "";
      }

      if (settled) {
        return;
      }
      settled = true;
      if (code === 0) {
        resolve(null);
      } else {
        reject(new Error(`Command failed with exit code ${code}`));
      }
    });
  });
}

function validateRubyEntrypoint(root: string, entrypoint: string) {
  if (entrypoint.trim() === "" || entrypoint === ".") {
    throw new Error(
      "Ruby evals require paths to name one entrypoint file (for example, evals/run.rb)",
    );
  }

  const resolved = path.resolve(root, entrypoint);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    throw new Error(`Ruby eval entrypoint does not exist: ${entrypoint}`);
  }
  if (!stat.isFile()) {
    throw new Error(`Ruby eval entrypoint is not a file: ${entrypoint}`);
  }
}

export function buildEvalCommand(args: Params): EvalCommand {
  const { paths, terminate_on_failure } = args;
  const terminateFlag = terminate_on_failure ? "--terminate-on-failure" : "";

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
      const display = `${baseCommand} eval --jsonl ${terminateFlag} ${paths}`;
      return { command: display, display, shell: true };
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
      const display = `${baseCommand} eval --jsonl ${terminateFlag} ${paths}`;
      return { command: display, display, shell: true };
    }
    case "go":
      switch ((args.package_manager || "").toLowerCase().trim()) {
        case "":
        case "go": {
          if (terminate_on_failure) {
            core.info("Ignoring terminate_on_failure for Go evals");
          }
          const display = `go run ${paths}`;
          return { command: display, display, shell: true };
        }
        default:
          throw new Error(
            `Unsupported package manager: ${args.package_manager}`,
          );
      }
    case "ruby": {
      validateRubyEntrypoint(args.root, paths);
      if (terminate_on_failure) {
        core.info("Ignoring terminate_on_failure for Ruby evals");
      }
      switch ((args.package_manager || "").toLowerCase().trim()) {
        case "":
          return {
            command: "ruby",
            args: [paths],
            display: `ruby ${JSON.stringify(paths)}`,
          };
        case "bundler":
          return {
            command: "bundle",
            args: ["exec", "ruby", paths],
            display: `bundle exec ruby ${JSON.stringify(paths)}`,
          };
        default:
          throw new Error(
            `Unsupported package manager: ${args.package_manager}`,
          );
      }
    }
    default:
      throw new Error(`Unsupported runtime: ${args.runtime}`);
  }
}

export async function runEval(args: Params, onSummary: OnSummaryFn) {
  const { api_key, root } = args;

  // Add the API key to the environment
  core.exportVariable("BRAINTRUST_API_KEY", api_key);

  if (!process.env.OPENAI_API_KEY) {
    core.exportVariable("OPENAI_API_KEY", api_key);
  }

  if (args.use_proxy) {
    core.exportVariable("OPENAI_BASE_URL", "https://braintrustproxy.com/v1");
  }

  const cwd = path.resolve(root);
  await runCommand(buildEvalCommand(args), cwd, onSummary);
}
