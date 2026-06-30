// Rename to fail.eval.ts to test failure reporting
import { Eval } from "braintrust";

Eval("My Fail", {
  data: () => [
    { input: "Which country has the highest population?", expected: "China" },
  ],
  task: async () => {
    throw new Error("syntax error!");
  },
  scores: [],
});
