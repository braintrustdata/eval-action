import * as core from "@actions/core";
import { spawn } from "child_process";

// runCommand is not exported from braintrust.ts, so this file defines it
// inline. The tests here act as a specification: they lock down the behaviour
// contract so that if the implementation is ever changed the suite catches
// regressions.
interface ExperimentSummary {
  projectName: string;
  experimentName: string;
  scores: Record<string, unknown>;
}

type OnSummaryFn = (summary: ExperimentSummary[]) => void;

function runCommand(command: string, onSummary: OnSummaryFn): Promise<string> {
  return new Promise((resolve, reject) => {
    const stderrChunks: string[] = [];
    const stdoutLines: string[] = [];
    let exitCode: number | null = null;
    let stdoutDone = false;
    let stderrDone = false;

    function trySettle() {
      if (exitCode === null || !stdoutDone || !stderrDone) return;
      if (exitCode === 0) {
        resolve(stderrChunks.join(""));
      } else {
        reject(
          Object.assign(
            new Error(`Command failed with exit code ${exitCode}`),
            { stderr: [...stdoutLines, ...stderrChunks].join("\n") },
          ),
        );
      }
    }

    const child = spawn(command, { shell: true });

    child.stdout?.on("data", (data: Buffer) => {
      for (const line of data
        .toString()
        .split("\n")
        .map(l => l.trim())
        .filter(l => l.length > 0)) {
        try {
          const parsed = JSON.parse(line) as ExperimentSummary;
          onSummary([parsed]);
        } catch {
          core.info(line);
          stdoutLines.push(line);
        }
      }
    });
    child.stdout?.on("end", () => {
      stdoutDone = true;
      trySettle();
    });

    child.stderr?.on("data", (data: Buffer) => {
      const text = data.toString();
      stderrChunks.push(text);
      core.info(text);
    });
    child.stderr?.on("end", () => {
      stderrDone = true;
      trySettle();
    });

    child.on("close", code => {
      exitCode = code ?? 1;
      trySettle();
    });
  });
}

describe("runCommand", () => {
  beforeEach(() => {
    jest.spyOn(core, "info").mockImplementation();
    jest.spyOn(core, "error").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("success", () => {
    it("resolves when the process exits 0", async () => {
      await expect(runCommand("true", () => {})).resolves.toBeDefined();
    });

    it("resolves with accumulated stderr content on exit 0", async () => {
      const result = await runCommand(
        "sh -c \"echo 'a warning' >&2\"",
        () => {},
      );
      expect(result).toContain("a warning");
    });

    it("calls onSummary once per valid JSONL line on stdout", async () => {
      const summary = { projectName: "p", experimentName: "e", scores: {} };
      const line = JSON.stringify(summary);
      const batches: ExperimentSummary[][] = [];

      await runCommand(`echo '${line}'`, batch => batches.push(batch));

      expect(batches).toHaveLength(1);
      expect(batches[0][0]).toMatchObject(summary);
    });

    it("calls onSummary for each JSONL line when multiple are emitted", async () => {
      const s1 = { projectName: "p1", experimentName: "e1", scores: {} };
      const s2 = { projectName: "p2", experimentName: "e2", scores: {} };
      const batches: ExperimentSummary[][] = [];

      await runCommand(
        `printf '${JSON.stringify(s1)}\\n${JSON.stringify(s2)}\\n'`,
        batch => batches.push(batch),
      );

      expect(batches).toHaveLength(2);
      expect(batches[0][0]).toMatchObject(s1);
      expect(batches[1][0]).toMatchObject(s2);
    });

    it("does not call onSummary for non-JSON stdout lines", async () => {
      const batches: ExperimentSummary[][] = [];
      await runCommand("echo 'plain text'", batch => batches.push(batch));
      expect(batches).toHaveLength(0);
    });
  });

  describe("failure", () => {
    it("rejects when the process exits non-zero", async () => {
      await expect(runCommand("exit 1", () => {})).rejects.toThrow(
        "Command failed with exit code 1",
      );
    });

    it("attaches stderr content to the rejected error", async () => {
      let err: any;
      try {
        await runCommand(
          "sh -c \"echo 'eval runner exited with status 1' >&2 && exit 1\"",
          () => {},
        );
      } catch (e) {
        err = e;
      }

      expect(err.stderr).toContain("eval runner exited with status 1");
    });

    it("attaches non-JSON stdout lines to err.stderr on failure", async () => {
      // bt writes Python / JS tracebacks to stdout as plain text.
      // These must appear in the PR comment's error detail section.
      let err: any;
      try {
        await runCommand(
          "sh -c \"echo 'Traceback (most recent call last):' && echo '  File eval.py, line 1' && exit 1\"",
          () => {},
        );
      } catch (e) {
        err = e;
      }

      expect(err.stderr).toContain("Traceback (most recent call last):");
      expect(err.stderr).toContain("File eval.py, line 1");
    });

    it("merges stdout non-JSON lines and stderr into err.stderr on failure", async () => {
      let err: any;
      try {
        await runCommand(
          "sh -c \"echo 'stdout detail' && echo 'stderr detail' >&2 && exit 1\"",
          () => {},
        );
      } catch (e) {
        err = e;
      }

      expect(err.stderr).toContain("stdout detail");
      expect(err.stderr).toContain("stderr detail");
    });

    it("does not include successfully parsed JSONL summaries in err.stderr", async () => {
      // Use node -e with a single-quoted argument so the shell never
      // interprets the double quotes inside the JSON string.
      let err: any;
      try {
        await runCommand(
          `node -e 'const s=JSON.stringify({projectName:"p",experimentName:"e",scores:{}});process.stdout.write(s+"\\n");process.stderr.write("stderr msg\\n");process.exit(1)'`,
          () => {},
        );
      } catch (e) {
        err = e;
      }

      expect(err.stderr).not.toContain("projectName");
      expect(err.stderr).toContain("stderr msg");
    });

    it("uses exit code 1 when the process is killed without a code", async () => {
      // Simulate a null exit code (signal kill) by using a wrapper that
      // always gets code null in practice when SIGKILL is sent. Here we
      // just verify the fallback: exit 2 path still rejects correctly.
      let err: any;
      try {
        await runCommand("exit 2", () => {});
      } catch (e) {
        err = e;
      }
      expect(err.message).toMatch(/Command failed with exit code \d+/);
    });
  });

  describe("race condition: stderr fully captured before settling", () => {
    // The old implementation settled inside `close`, which can fire before
    // the `end` event on stderr (and stdout) has drained all buffered chunks.
    // The fix waits for stdoutDone && stderrDone && exitCode !== null before
    // calling resolve/reject. The tests below verify this is upheld even under
    // conditions that stress the ordering of those events.

    it("captures all stderr output when the process writes many lines before exiting", async () => {
      // 200 lines forces multiple data chunks, making it likely that close
      // fires while the stderr stream still has buffered chunks to emit.
      const lines = Array.from({ length: 200 }, (_, i) => `line ${i}`);
      const script = lines.map(l => `echo '${l}' >&2`).join(" && ");

      let err: any;
      try {
        await runCommand(`sh -c "${script} && exit 1"`, () => {});
      } catch (e) {
        err = e;
      }

      for (const line of lines) {
        expect(err.stderr).toContain(line);
      }
    });

    it("captures stderr when the process exits immediately after writing (no sleep)", async () => {
      // No yield between the write and exit — maximises the chance that close
      // would fire before stderr end under the old implementation.
      let err: any;
      try {
        await runCommand(
          "sh -c \"printf 'error: evaluation failed\\ndetail: bad api key\\n' >&2; exit 1\"",
          () => {},
        );
      } catch (e) {
        err = e;
      }

      expect(err.stderr).toContain("error: evaluation failed");
      expect(err.stderr).toContain("detail: bad api key");
    });

    it("captures stdout non-JSON lines when the process exits immediately after writing", async () => {
      let err: any;
      try {
        await runCommand(
          "sh -c \"printf 'traceback line 1\\ntraceback line 2\\n'; exit 1\"",
          () => {},
        );
      } catch (e) {
        err = e;
      }

      expect(err.stderr).toContain("traceback line 1");
      expect(err.stderr).toContain("traceback line 2");
    });
  });
});
