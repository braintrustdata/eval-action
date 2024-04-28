// This code is partially derived from https://github.com/int128/comment-action/blob/main/src/comment.ts

import * as core from "@actions/core";
import * as github from "@actions/github";

type Octokit = ReturnType<typeof github.getOctokit>;

type PullRequest = {
  owner: string;
  repo: string;
  issue_number: number;
};

export async function upsertComment() {
  const githubToken = core.getInput("github_token");
  const octokit = github.getOctokit(githubToken);

  const prs = await inferPullRequestsFromContext(octokit);

  const commentBody = `<!-- braintrust_bot_comment -->
Thank you for your pull request!`;

  for (const pr of prs) {
    const response = await octokit.rest.issues.createComment({
      ...pr,
      body: commentBody
    });
  }
}

const inferPullRequestsFromContext = async (
  octokit: Octokit
): Promise<PullRequest[]> => {
  const { context } = github;
  if (Number.isSafeInteger(context.issue.number)) {
    core.info(`Use #${context.issue.number} from the current context`);
    return [
      {
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: context.issue.number
      }
    ];
  }

  core.info(`List pull requests associated with sha ${context.sha}`);
  const pulls = await octokit.rest.repos.listPullRequestsAssociatedWithCommit({
    owner: context.repo.owner,
    repo: context.repo.repo,
    commit_sha: context.sha
  });
  for (const pull of pulls.data) {
    core.info(`  #${pull.number}: ${pull.title}`);
  }
  return pulls.data.map(p => ({
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: p.number
  }));
};
