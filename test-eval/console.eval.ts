import { Eval } from "braintrust";
import { LevenshteinScorer } from "autoevals";

const NUM_EXAMPLES = 20;
const data = Array.from({ length: NUM_EXAMPLES }, (_, i) => ({
  input: `Foo${i}`,
  expected: `Hi Foo${i}`,
}));

Eval("Console logging", {
  data: () => data,
  task: async input => {
    // Uncomment to break the eval via spurious console logs
    // console.log("distracting text");
    // console.log(JSON.stringify({ input }));
    return `Hi Foo${Math.floor(Math.random() * NUM_EXAMPLES)}`; // Replace with your LLM call
  },
  scores: [LevenshteinScorer],
});
