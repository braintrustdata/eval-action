import path from "path";
import * as core from "@actions/core";
import * as process from "process";
import { exec as execSync } from "child_process";

import { Params } from "./main";
import { ExperimentSummary } from "braintrust";

function runCommand(
  command: string,
  onSummary: (summary: ExperimentSummary) => void,
) {
  return new Promise((resolve, reject) => {
    const process = execSync(command);

    process.stdout?.on("data", text => {
      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        if (text.trim() === "") {
          return;
        }
        core.error(`${e}`);
      }

      if (data && data.experimentName) {
        onSummary(data as ExperimentSummary);
      }
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

export async function runEval(args: Params) {
  const { api_key, root, paths } = args;

  // Add the API key to the environment
  core.exportVariable("BRAINTRUST_API_KEY", api_key);
  if (!process.env.OPENAI_API_KEY) {
    core.exportVariable("OPENAI_API_KEY", api_key);
  }

  // Change working directory
  process.chdir(path.resolve(root));

  const command = `npx braintrust eval --jsonl ${paths}`;
  await runCommand(command);

  /*
  // Read the summary files
  const summaryFiles = await fsp.readdir(reportersDir);
  const summaries: SummaryInfo[] = await Promise.all(
    summaryFiles.map(async summaryFile => {
      const summaryPath = path.join(reportersDir, summaryFile);
      const summaryData = JSON.parse(
        await fsp.readFile(summaryPath, "utf8"),
      ) as SummaryInfo;
      return summaryData;
    }),
  );
  */

  return [];
}
