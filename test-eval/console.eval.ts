import { Eval } from "braintrust";
import { LevenshteinScorer } from "autoevals";

const NUM_EXAMPLES = 20;
const data = Array.from({ length: NUM_EXAMPLES }, (_, i) => ({
  input: `Foo${i}`,
  expected: `Hi Foo${i}`,
}));

Eval("Say Hi Bot", {
  data: () => data,
  task: async input => {
    console.log("distracting text");
    return `Hi Foo${Math.floor(Math.random() * NUM_EXAMPLES)}`; // Replace with your LLM call
  },
  scores: [LevenshteinScorer],
});
