import { traced, Eval } from "braintrust";

Eval("My Fail", {
  data: () => [
    { input: "Which country has the highest population?", expected: "China" },
  ],
  task: async (input, { span }) => {
    throw new Error("syntax error!");
  },
  scores: [],
});
