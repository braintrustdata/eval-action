import { spawn } from "child_process";
import * as core from "@actions/core";

// We'll test the actual spawning behavior with real commands
describe("braintrust Buffer handling", () => {
  beforeEach(() => {
    // Silence the core.info and core.error logs during tests
    jest.spyOn(core, "info").mockImplementation();
    jest.spyOn(core, "error").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("should handle Buffer output from echo command", async () => {
    const result = await new Promise<string[]>((resolve, reject) => {
      const outputs: string[] = [];
      const process = spawn("echo", ["test output"], { shell: true });

      process.stdout?.on("data", (data: Buffer) => {
        // This is what our fix does - convert Buffer to string
        outputs.push(data.toString());
      });

      process.on("close", code => {
        if (code === 0) {
          resolve(outputs);
        } else {
          reject(new Error(`Process failed with code ${code}`));
        }
      });
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toContain("test output");
  });

  it("should handle multiline Buffer output", async () => {
    const testJson = { test_field: "value", score: 0.95 };
    const jsonString = JSON.stringify(testJson);

    const result = await new Promise<any[]>((resolve, reject) => {
      const parsed: any[] = [];
      // Use printf to output exactly what we want without extra newline
      const process = spawn("printf", [`'${jsonString}\\n'`], { shell: true });

      process.stdout?.on("data", (data: Buffer) => {
        for (const line of data
          .toString()
          .split("\n")
          .map(l => l.trim())
          .filter(l => l.length > 0)) {
          try {
            parsed.push(JSON.parse(line));
          } catch {
            // Skip non-JSON lines
          }
        }
      });

      process.on("close", code => {
        if (code === 0) {
          resolve(parsed);
        } else {
          reject(new Error(`Process failed with code ${code}`));
        }
      });
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(testJson);
  });

  it("should handle stderr as Buffer", async () => {
    const stderrOutput = await new Promise<string>(resolve => {
      let error = "";
      // Command that writes to stderr
      const process = spawn("sh", ["-c", "echo 'error message' >&2"], {
        shell: false,
      });

      process.stderr?.on("data", (data: Buffer) => {
        error += data.toString();
      });

      process.on("close", () => {
        resolve(error);
      });
    });

    expect(stderrOutput).toContain("error message");
  });
});
