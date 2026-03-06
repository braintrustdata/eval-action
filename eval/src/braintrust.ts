import os from "os";
import path from "path";
import * as core from "@actions/core";
import { spawn } from "child_process";

import { Params } from "./main";

export interface ScoreSummary {
  name: string;
  score: number;
  diff?: number;
  improvements: number;
  regressions: number;
}

export interface MetricSummary {
  name: string;
  metric: number;
  unit: string;
  diff?: number;
  improvements: number;
  regressions: number;
}

export interface ExperimentSummary {
  projectName: string;
  experimentName: string;
  projectId?: string;
  experimentId?: string;
  projectUrl?: string;
  experimentUrl?: string;
  comparisonExperimentName?: string;
  scores: Record<string, ScoreSummary>;
  metrics?: Record<string, MetricSummary>;
}

export interface ExperimentFailure {
  evaluatorName: string;
  errors: string[];
}

type OnSummaryFn = (summary: (ExperimentSummary | ExperimentFailure)[]) => void;

// Installs the bt CLI and adds its bin directory to PATH for the current
// process. version may be:
//   ""                       → latest stable via https://bt.dev/cli/install.sh
//   semver like "0.2.0"      → pinned stable via the same script with --version
//   release tag like "canary-add-glob-support" → canary installer from GH release
async function installBt(version: string): Promise<void> {
  const isCanary = version !== "" && !version.match(/^\d+\.\d+\.\d+/);

  let installCmd: string;
  if (isCanary) {
    installCmd = `curl -fsSL https://github.com/braintrustdata/bt/releases/download/${version}/bt-installer.sh | bash`;
  } else if (version !== "") {
    installCmd = `curl -fsSL https://bt.dev/cli/install.sh | bash -s -- --version ${version}`;
  } else {
    installCmd = `curl -fsSL https://bt.dev/cli/install.sh | bash`;
  }

  core.info(`Installing bt CLI: ${installCmd}`);
  await runCommand(installCmd, () => {});

  // The installer puts the binary in ~/.local/bin (or $XDG_BIN_HOME).
  // Make sure the spawned child processes can find it.
  const localBin = path.join(os.homedir(), ".local", "bin");
  const xdgBin = process.env.XDG_BIN_HOME ?? "";
  for (const dir of [xdgBin, localBin]) {
    if (dir && !process.env.PATH?.includes(dir)) {
      process.env.PATH = `${dir}:${process.env.PATH}`;
    }
  }
}

async function runCommand(
  command: string,
  onSummary: OnSummaryFn,
): Promise<string> {
  core.info(`> $ ${command}`);
  return new Promise((resolve, reject) => {
    const stderrChunks: string[] = [];

    const child = spawn(command, { shell: true });

    child.stdout?.on("data", (data: Buffer) => {
      data
        .toString()
        .split("\n")
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .forEach(line => {
          try {
            const parsed = JSON.parse(line) as ExperimentSummary;
            onSummary([parsed]);
          } catch (e) {
            core.error(`Failed to parse jsonl data: ${e}`);
          }
        });
    });

    child.stderr?.on("data", (data: Buffer) => {
      const text = data.toString();
      stderrChunks.push(text);
      core.info(text);
    });

    child.on("close", code => {
      if (code === 0) {
        resolve(stderrChunks.join(""));
      } else {
        reject(
          Object.assign(
            new Error(`Command failed with exit code ${code}`),
            { stderr: stderrChunks.join("") },
          ),
        );
      }
    });
  });
}

export async function runEval(args: Params, onSummary: OnSummaryFn) {
  const { api_key, root, paths, terminate_on_failure } = args;

  core.exportVariable("BRAINTRUST_API_KEY", api_key);

  if (!process.env.OPENAI_API_KEY) {
    core.exportVariable("OPENAI_API_KEY", api_key);
  }

  if (args.use_proxy) {
    core.exportVariable("OPENAI_BASE_URL", "https://braintrustproxy.com/v1");
  }

  await installBt(args.bt_version);

  core.info(`cwd before chdir: ${process.cwd()}`);
  core.info(`resolving root '${root}' → ${path.resolve(root)}`);
  process.chdir(path.resolve(root));
  core.info(`cwd after chdir: ${process.cwd()}`);
  await runCommand("bt --version && ls -la", () => {});

  // Build bt eval flags
  const flags: string[] = ["--jsonl", "--verbose"];

  if (terminate_on_failure) {
    flags.push("--terminate-on-failure");
  }

  // --runner: explicit input takes precedence; fall back to deriving --language
  // from the deprecated runtime input so existing configs keep working.
  if (args.runner) {
    flags.push(`--runner ${args.runner}`);
  } else if (args.runtime === "python") {
    flags.push("--language python");
  }

  if (args.filter) {
    flags.push(`--filter ${args.filter}`);
  }

  const command = `bt eval ${flags.join(" ")} ${paths}`;
  core.info(`running: ${command}`);

  try {
    await runCommand(command, onSummary);
  } catch (err: any) {
    // Surface stderr as a structured failure so the PR comment can show details.
    const stderr: string = err?.stderr ?? "";
    if (stderr) {
      onSummary([
        {
          evaluatorName: "eval",
          errors: stderr.split("\n").filter((l: string) => l.trim()),
        },
      ]);
    }
    throw err;
  }
}
