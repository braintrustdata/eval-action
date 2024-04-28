import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import * as core from "@actions/core";
import * as util from "util";
import * as os from "os";
import { exec as execSync } from "child_process";

import { Params } from "./main";
import { ExperimentSummary } from "braintrust";

const exec = util.promisify(execSync);

// Function to load file content
function loadFileContent() {
  const filePath = path.join(__dirname, "reporter.eval.ts");
  return fs.readFileSync(filePath, "utf8");
}
const REPORTER = loadFileContent();

export interface SummaryInfo {
  evaluator: {
    evalName: string;
    projectName: string;
  };
  summary: ExperimentSummary;
}

export async function runEval(args: Params) {
  const { api_key, root, paths } = args;

  // Add the API key to the environment
  core.exportVariable("BRAINTRUST_API_KEY", api_key);
  if (!process.env.OPENAI_API_KEY) {
    core.exportVariable("OPENAI_API_KEY", api_key);
  }

  // Make a temporary directory for reporters to leave their results
  const tmpdir = os.tmpdir();
  const reportersDir = path.join(tmpdir, "reporters");
  await fsp.mkdir(reportersDir, { recursive: true });

  core.exportVariable("BRAINTRUST_REPORTERS_DIR", reportersDir);

  const reporterFile = path.join(tmpdir, "action-reporter.eval.ts");
  await fsp.writeFile(reporterFile, REPORTER);

  // Change working directory
  process.chdir(path.resolve(root));

  const command = `npx braintrust eval ${paths} ${reporterFile}`;
  await exec(command);

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

  return summaries;
}
