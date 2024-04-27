import * as core from "@actions/core";
import z from "zod";

const params = z.strictObject({
  root: z.string(),
  paths: z.string(),
  runtime: z.enum(["auto", "node", "python"])
});

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    const argsP = params.safeParse({
      root: core.getInput("root"),
      paths: core.getInput("paths"),
      runtime: core.getInput("runtime")
    });
    if (!argsP.success) {
      throw new Error(
        "Invalid arguments: " +
          argsP.error.errors.map(e => e.message).join("\n")
      );
    }

    core.debug("Hello, world!");
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message);
  }
}
