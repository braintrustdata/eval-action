import { traced, Eval } from "braintrust";

async function callModel(input) {
  return traced(
    async (span) => {
      const messages = { messages: [{ role: "system", text: input }] };
      span.log({ input: messages });

      // Replace this with a model call
      const result = {
        content: "China",
        latency: 1,
        prompt_tokens: 10,
        completion_tokens: 2,
      };

      span.log({
        output: result.content,
        metrics: {
          latency: result.latency,
          prompt_tokens: result.prompt_tokens,
          completion_tokens: result.completion_tokens,
        },
      });
      return result.content;
    },
    {
      name: "My AI model",
    },
  );
}

const exactMatch = (args: { input; output; expected? }) => {
  return {
    name: "Exact match",
    score: args.output === args.expected ? 1 : 0,
  };
};

Eval("My Evaluation", {
  data: () => [
    { input: "Which country has the highest population?", expected: "China" },
  ],
  task: async (input, { span }) => {
    await new Promise((resolve) => setTimeout(resolve, Math.random() * 1000));
    return await callModel(input);
  },
  scores: [exactMatch],
});
