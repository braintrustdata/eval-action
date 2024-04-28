import * as fs from "fs";
import { Reporter } from "braintrust";

Reporter("action-summary", {
  reportEval: async (evaluator, result, opts) => {
    const summaryData = {
      evaluator,
      summary: result.summary,
    };
    const tmpDir = process.env.BRAINTRUST_REPORTERS_DIR;
    const summaryPath = `${tmpDir}/${crypto.randomUUID()}.json`;
    await fs.promises.writeFile(
      summaryPath,
      JSON.stringify(summaryData, null, 2),
    );
  },
  reportRun: async reports => {
    return true;
  },
});
