import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { describe, expect, it } from "vite-plus/test";

import { Params } from "./main";
import { buildRubyCommand } from "./braintrust";

function rubyParams(overrides: Partial<Params> = {}): Params {
  return {
    api_key: "test-key",
    root: ".",
    paths: ".",
    runtime: "ruby",
    package_manager: "",
    use_proxy: false,
    terminate_on_failure: false,
    report_scores: [],
    report_metrics: [],
    ...overrides,
  };
}

describe("buildRubyCommand", () => {
  it("passes an entrypoint containing spaces as one Bundler argument", () => {
    const root = mkdtempSync(path.join(tmpdir(), "eval-action-ruby-"));
    mkdirSync(path.join(root, "eval files"));
    writeFileSync(path.join(root, "eval files", "run eval.rb"), "");

    expect(
      buildRubyCommand(
        rubyParams({
          package_manager: "bundler",
          root,
          paths: "eval files/run eval.rb",
        }),
      ),
    ).toEqual({
      command: "bundle",
      args: ["exec", "ruby", "eval files/run eval.rb"],
    });
  });

  it("uses Ruby directly when the package manager is omitted", () => {
    const root = mkdtempSync(path.join(tmpdir(), "eval-action-ruby-"));
    writeFileSync(path.join(root, "run.rb"), "");

    expect(buildRubyCommand(rubyParams({ root, paths: "run.rb" }))).toEqual({
      command: "ruby",
      args: ["run.rb"],
    });
  });

  it("rejects the default path, a missing path, and a directory", () => {
    const root = mkdtempSync(path.join(tmpdir(), "eval-action-ruby-"));
    mkdirSync(path.join(root, "evals"));

    expect(() => buildRubyCommand(rubyParams({ root, paths: "." }))).toThrow(
      /one entrypoint file/,
    );
    expect(() =>
      buildRubyCommand(rubyParams({ root, paths: "missing.rb" })),
    ).toThrow(/does not exist: missing\.rb/);
    expect(() =>
      buildRubyCommand(rubyParams({ root, paths: "evals" })),
    ).toThrow(/not a file: evals/);
  });
});
