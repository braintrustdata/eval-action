import path from "path";
import { OpenAI } from "openai";

import { Scorer } from "@braintrust/core";
import { LLMClassifierArgs, Sql } from "autoevals";
import { Eval, currentSpan, traced, wrapOpenAI } from "braintrust";
import {
  Example,
  AISearchOutput,
  braintrustRootPath,
  extractAISearchResult,
  getTestProxyServerConfig,
  projectSearchCompletionArgs,
  renderExample,
} from "@braintrust/local";

const PROJECT_EXAMPLES_FILE = path.join(
  braintrustRootPath(),
  "evals/ai-search/project/examples.json",
);

const aiSchemaColumns = ["avg_foo_score", "avg_bar_score"];

async function loadProjectExamples(): Promise<Example[]> {
  const examples = require(PROJECT_EXAMPLES_FILE).examples as Example[];
  return examples.map((e) => renderExample(e, { aiSchemaColumns }));
}

const API_KEY = process.env.BRAINTRUST_API_KEY;

let _proxyUrl: string | undefined = undefined;
async function getProxyUrl() {
  if (_proxyUrl === undefined) {
    const SERVER_CONFIG = await getTestProxyServerConfig();
    _proxyUrl = `http://${SERVER_CONFIG.host}:${SERVER_CONFIG.port}/proxy/v1`;
  }
  return _proxyUrl;
}

async function getClientOpts() {
  return {
    apiKey: API_KEY,
    baseURL: await getProxyUrl(),
    defaultHeaders: { "x-bt-use-cache": "always" },
  };
}

async function getOpenAiArgs() {
  const opts = await getClientOpts();
  return {
    openAiApiKey: opts.apiKey,
    openAiBaseUrl: opts.baseURL,
    openAiDefaultHeaders: opts.defaultHeaders,
  };
}

async function runAISearch(input: string): Promise<AISearchOutput> {
  const openAI = wrapOpenAI(new OpenAI(await getClientOpts()));
  const args = projectSearchCompletionArgs({
    searchType: "projectExperiments",
    query: input,
    aiSchemaColumns,
  });
  const completion = await openAI.chat.completions.create(args);
  return extractAISearchResult(completion);
}

const AutoSearch: Scorer<
  AISearchOutput,
  LLMClassifierArgs<{ input: string }>
> = async ({ output, expected, ...args }) => {
  if (expected === undefined) {
    throw new Error("AutoSearch requires an expected value");
  }

  const name = "AutoSearch";

  if (output.match !== expected.match) {
    currentSpan().log({ scores: { functionChoice: 0 } });
    return { name, score: 0 };
  }

  currentSpan().log({ scores: { functionChoice: 1 } });
  if (expected.match) {
    return { name, score: 1 };
  }

  let filterScore: number | null = null;
  if (output.filter && expected.filter) {
    filterScore =
      (
        await traced(
          async (span) => {
            const sqlOutput = await Sql({
              ...args,
              output: output.filter,
              expected: expected.filter,
            });
            span.log({
              input: { output: output.filter, expected: expected.filter },
              output: sqlOutput,
            });
            return sqlOutput;
          },
          { name: "AutoFilter" },
        )
      ).score || 0;
  } else if (output.filter || expected.filter) {
    filterScore = 0;
  }
  currentSpan().log({ scores: { filter: filterScore } });

  let sortScore: number | null = null;
  if (output.sort && expected.sort) {
    sortScore =
      (
        await traced(
          async (span) => {
            const sqlOutput = await Sql({
              ...args,
              output: output.sort,
              expected: expected.sort,
            });
            span.log({
              input: { output: output.sort, expected: expected.sort },
              output: sqlOutput,
            });
            return sqlOutput;
          },
          { name: "AutoSort" },
        )
      ).score || 0;
  } else if (output.sort || expected.sort) {
    sortScore = 0;
  }
  currentSpan().log({ scores: { sort: sortScore } });

  const scores: number[] = [];
  for (const score of [filterScore, sortScore]) {
    if (score !== null) {
      scores.push(score);
    }
  }
  if (scores.length === 0) {
    return {
      name,
      score: 0,
      error: "Bad example: no filter or sort for expected SQL function call",
    };
  }
  return { name, score: scores.reduce((a, b) => a + b, 0) / scores.length };
};

Eval("AI Search Eval", {
  data: async () => await loadProjectExamples(),
  task: async (input: string, { span }) => {
    span.traced(
      async () =>
        await new Promise((resolve) =>
          setTimeout(resolve, Math.random() * 1000),
        ),
      { name: "Random Sleep" },
    );
    return await runAISearch(input);
  },
  scores: [async (args) => AutoSearch({ ...args, ...(await getOpenAiArgs()) })],
});
