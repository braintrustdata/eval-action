import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { describe, expect, it } from "vite-plus/test";

import { Params } from "./main";
import { buildEvalCommand, parseSummaryLine, runCommand } from "./braintrust";

function params(overrides: Partial<Params> = {}): Params {
  return {
    api_key: "test-key",
    root: ".",
    paths: ".",
    runtime: "node",
    package_manager: "",
    use_proxy: false,
    terminate_on_failure: false,
    report_scores: [],
    report_metrics: [],
    ...overrides,
  };
}

describe("buildEvalCommand", () => {
  it("passes a Ruby entrypoint containing spaces as one argument", () => {
    const root = mkdtempSync(path.join(tmpdir(), "eval-action-ruby-"));
    mkdirSync(path.join(root, "eval files"));
    writeFileSync(path.join(root, "eval files", "run eval.rb"), "");

    expect(
      buildEvalCommand(
        params({
          runtime: "ruby",
          package_manager: "bundler",
          root,
          paths: "eval files/run eval.rb",
        }),
      ),
    ).toMatchObject({
      command: "bundle",
      args: ["exec", "ruby", "eval files/run eval.rb"],
    });
  });

  it("uses Ruby directly when the package manager is omitted", () => {
    const root = mkdtempSync(path.join(tmpdir(), "eval-action-ruby-"));
    writeFileSync(path.join(root, "run.rb"), "");

    expect(
      buildEvalCommand(params({ runtime: "ruby", root, paths: "run.rb" })),
    ).toMatchObject({ command: "ruby", args: ["run.rb"] });
  });

  it("rejects the default path, a missing path, and a directory", () => {
    const root = mkdtempSync(path.join(tmpdir(), "eval-action-ruby-"));
    mkdirSync(path.join(root, "evals"));

    expect(() =>
      buildEvalCommand(params({ runtime: "ruby", root, paths: "." })),
    ).toThrow(/one entrypoint file/);
    expect(() =>
      buildEvalCommand(params({ runtime: "ruby", root, paths: "missing.rb" })),
    ).toThrow(/does not exist: missing\.rb/);
    expect(() =>
      buildEvalCommand(params({ runtime: "ruby", root, paths: "evals" })),
    ).toThrow(/not a file: evals/);
  });

  it("preserves existing runtime command construction", () => {
    expect(buildEvalCommand(params()).display).toBe(
      "npx braintrust eval --jsonl  .",
    );
    expect(
      buildEvalCommand(
        params({
          runtime: "python",
          package_manager: "uv",
          paths: "evals/*.py",
          terminate_on_failure: true,
        }),
      ).display,
    ).toBe("uv run braintrust eval --jsonl --terminate-on-failure evals/*.py");
    expect(
      buildEvalCommand(
        params({ runtime: "go", package_manager: "go", paths: "./cmd/eval" }),
      ).display,
    ).toBe("go run ./cmd/eval");
  });
});

describe("JSONL handling", () => {
  it("normalizes Ruby REST summaries and removes nullable diffs", () => {
    expect(
      parseSummaryLine(
        JSON.stringify({
          project_name: "Ruby evals",
          experiment_name: "ci",
          experiment_url: "https://example.com/experiment",
          scores: {
            Accuracy: {
              score: 0.9,
              diff: null,
              improvements: 3,
              regressions: 1,
            },
          },
          metrics: { Duration: { metric: 1.25, unit: "s", diff: -0.1 } },
        }),
      ),
    ).toEqual([
      {
        projectName: "Ruby evals",
        experimentName: "ci",
        experimentUrl: "https://example.com/experiment",
        scores: {
          Accuracy: { score: 0.9, improvements: 3, regressions: 1 },
        },
        metrics: { Duration: { metric: 1.25, unit: "s", diff: -0.1 } },
      },
    ]);
  });

  it("recognizes separate error records", () => {
    expect(
      parseSummaryLine('{"evaluator_name":"ci","errors":["task failed"]}'),
    ).toEqual([{ evaluatorName: "ci", errors: ["task failed"] }]);
  });

  it("ignores ordinary logs and malformed JSON", () => {
    expect(parseSummaryLine("running eval...")).toEqual([]);
    expect(parseSummaryLine("{not-json")).toEqual([]);
    expect(parseSummaryLine('{"status":"complete"}')).toEqual([]);
    expect(parseSummaryLine("[]")).toEqual([]);
  });

  it("streams split lines and a final line without a newline", async () => {
    const summaries: unknown[] = [];
    const code = [
      `process.stdout.write('{"experiment_')`,
      `setTimeout(() => process.stdout.write('name":"one","scores":{}}\\n{"experiment_name":"two","metrics":{}}'), 10)`,
    ].join(";");

    await runCommand(
      {
        command: process.execPath,
        args: ["-e", code],
        display: "node fixture",
      },
      process.cwd(),
      value => summaries.push(...value),
    );

    expect(summaries).toMatchObject([
      { experimentName: "one" },
      { experimentName: "two" },
    ]);
  });

  it("rejects nonzero exits and missing executables", async () => {
    await expect(
      runCommand(
        {
          command: process.execPath,
          args: ["-e", "process.exit(7)"],
          display: "node failing fixture",
        },
        process.cwd(),
        () => undefined,
      ),
    ).rejects.toThrow(/exit code 7/);

    await expect(
      runCommand(
        {
          command: "/does-not-exist/braintrust-ruby",
          display: "missing fixture",
        },
        process.cwd(),
        () => undefined,
      ),
    ).rejects.toThrow(/Failed to start.*ENOENT/);
  });
});
