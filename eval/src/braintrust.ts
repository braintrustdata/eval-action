import path from "path";
import * as core from "@actions/core";
import { exec as execSync } from "child_process";

import { Params } from "./main";
import { ExperimentSummary } from "braintrust";

export interface ExperimentFailure {
  evaluatorName: string;
  errors: string[];
}

type OnSummaryFn = (summary: (ExperimentSummary | ExperimentFailure)[]) => void;

function snakeToCamelCase(str: string) {
  return str.replace(/([-_][a-z])/g, group => group.charAt(1).toUpperCase());
}

async function runCommand(command: string, onSummary: OnSummaryFn) {
  return new Promise((resolve, reject) => {
    const process = execSync(command);

    process.stdout?.on("data", (text: string) => {
      onSummary(
        text
          .split("\n")
          .map(line => line.trim())
          .filter(line => line.length > 0)
          .flatMap(line => {
            try {
              const parsedLine = JSON.parse(line);
              const camelCaseLine = Object.fromEntries(
                Object.entries(parsedLine).map(([key, value]) => [
                  snakeToCamelCase(key),
                  value,
                ]),
              );
              // TODO: This is hacky and we should be parsing what comes off the wire
              core.info(`${line}`);
              core.info(`${JSON.stringify(camelCaseLine)}`);
              return [camelCaseLine as unknown as ExperimentSummary];
            } catch (e) {
              core.error(`Failed to parse jsonl data: ${e}`);
              return [];
            }
          }),
      );
    });

    process.stderr?.on("data", data => {
      core.info(data); // Outputs the stderr of the command
    });

    process.on("close", code => {
      if (code === 0) {
        resolve(null);
      } else {
        reject(new Error(`Command failed with exit code ${code}`));
      }
    });
  });
}

export async function runEval(args: Params, onSummary: OnSummaryFn) {
  const { api_key, root, paths } = args;

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

  let command: string;
  switch (args.runtime) {
    case "node":
      command = `npx braintrust eval --jsonl ${paths}`;
      break;
    case "python":
      command = `braintrust eval --jsonl ${paths}`;
      break;
    default:
      throw new Error(`Unsupported runtime: ${args.runtime}`);
  }
  await runCommand(command, onSummary);
}
