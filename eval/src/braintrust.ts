import path from "path";
import * as core from "@actions/core";
import * as process from "process";
import { exec as execSync } from "child_process";

import { Params } from "./main";
import { ExperimentSummary } from "braintrust";

export interface ExperimentFailure {
  evaluatorName: string;
  errors: string[];
}

type OnSummaryFn = (summary: (ExperimentSummary | ExperimentFailure)[]) => void;

function runCommand(command: string, onSummary: OnSummaryFn) {
  return new Promise((resolve, reject) => {
    const process = execSync(command);

    process.stdout?.on("data", (text: string) => {
      core.info("RECEIVED TEXT");
      core.info(text);
      onSummary(
        text
          .split("\n")
          .map(line => line.trim())
          .filter(line => line.length > 0)
          .flatMap(line => {
            try {
              return [JSON.parse(line)];
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
        reject(`Command failed with exit code ${code}`);
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

  // Change working directory
  process.chdir(path.resolve(root));

  const command = `npx braintrust eval --jsonl ${paths}`;
  await runCommand(command, onSummary);
}
