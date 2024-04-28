import * as core from "@actions/core";
import * as github from "@actions/github";

export async function upsertComment() {
  const githubToken = core.getInput("github_token", { required: true });
  const octokit = github.getOctokit(githubToken);

  const context = github.context;
  if (context.payload.pull_request == null) {
    throw new Error("No pull request found.");
  }

  const prNumber = context.payload.pull_request.number;
  const owner = context.repo.owner;
  const repo = context.repo.repo;

  const commentBody = `<!-- braintrust_bot_comment -->
Thank you for your pull request!`;

  const response = await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body: commentBody
  });
}
