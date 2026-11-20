# Braintrust Eval Action

Run [Braintrust evals](https://www.braintrust.dev) in GitHub Actions and post a
live summary comment on the associated pull request.

## Quick start

```yaml
name: Braintrust evals

on:
  pull_request:
  push:

permissions:
  contents: read
  pull-requests: write

jobs:
  eval:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Run evals
        uses: braintrustdata/eval-action@v2
        with:
          api_key: ${{ secrets.BRAINTRUST_API_KEY }}
          runtime: node
```

> [!IMPORTANT]
> You must specify `permissions` for the action to leave comments on your PR.
> Without these permissions, you'll see GitHub API errors.

## Inputs

| Input                  | Required | Description                                                                                                                                                 |
| ---------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api_key`              | Yes      | Your [Braintrust API key](https://www.braintrust.dev/app/settings/api-keys).                                                                                |
| `runtime`              | Yes      | The runtime to use: `node`, `python`, `go`, or `ruby`.                                                                                                      |
| `root`                 | No       | Root directory containing your evals. Defaults to `.`.                                                                                                      |
| `paths`                | No       | Paths or glob patterns, relative to `root`, containing evals to run. For Ruby, this must be one entrypoint file. Defaults to `.`.                            |
| `package_manager`      | No       | `npm` or `pnpm` for Node; `pip` or `uv` for Python; `go` for Go; `bundler` for Ruby. Can be omitted for the default package manager.                         |
| `use_proxy`            | No       | Set to `true` to use the Braintrust proxy at `https://braintrustproxy.com/v1`, which can cache repetitive LLM calls and speed up evals. Defaults to `true`. |
| `terminate_on_failure` | No       | Set to `true` to stop the eval process when an error occurs. Defaults to `false`. Ignored for Go and Ruby evals.                                            |
| `report_scores`        | No       | Comma- or newline-separated score names to include in the PR comment. Defaults to all available scores.                                                     |
| `report_metrics`       | No       | Comma- or newline-separated metric names to include in the PR comment. Defaults to all available metrics.                                                  |
| `github_token`         | No       | GitHub token used to create or update PR comments. Defaults to `${{ github.token }}`.                                                                       |

## Full example

```yaml
name: Run pnpm evals

on:
  pull_request:
  push:
    # Uncomment to run only when files in the 'evals' directory change.
    # paths:
    #   - "evals/**"

permissions:
  contents: read
  pull-requests: write

jobs:
  eval:
    name: Run evals
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 10

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Run evals
        uses: braintrustdata/eval-action@v2
        with:
          api_key: ${{ secrets.BRAINTRUST_API_KEY }}
          runtime: node
          package_manager: pnpm
          root: my_eval_dir
```

For more fully configured workflows, see the `examples` directory:

- [`node with npm`](examples/node/npm.yml)
- [`node with pnpm`](examples/node/pnpm.yml)
- [`python with pip`](examples/python/pip.yml)
- [`python with uv`](examples/python/uv.yml)
- [`go`](examples/go/go.yml)
- [`ruby with Bundler`](examples/ruby/ruby.yml)

## Runtime behavior

- **Node and Python:** the action runs `braintrust eval --jsonl` from `root` and
  collects the emitted experiment summaries.
- **Go:** the action runs `go run ${paths}` from `root`. To include Go eval
  results in the PR comment, print each `ExperimentSummary` as one JSON line
  after calling `result.Summarize(ctx)`:

  ```go
  summary, err := result.Summarize(ctx)
  if err != nil {
      log.Fatal(err)
  }
  b, err := json.Marshal(summary)
  if err != nil {
      log.Fatal(err)
  }
  fmt.Println(string(b))
  ```
- **Ruby:** the action runs `ruby <entrypoint>` or
  `bundle exec ruby <entrypoint>` from `root`. `paths` is one required file,
  passed as one argument even when its name contains spaces. The entrypoint is
  responsible for running one or more evals and printing one summary JSON object
  per line. Ruby 3.2 or newer and the application's installed bundle are required.

  The Ruby SDK does not currently emit the action's server-backed comparison
  payload directly. Copy
  [`braintrust_report.rb`](examples/ruby/scripts/braintrust_report.rb) into the
  application and call `BraintrustCI.report(result)` after each `Eval.run`. The
  helper flushes the configured SDK tracer, reads the public experiment summary
  API, retries bounded ingestion delays, and prints compatible JSONL. See the
  [complete Ruby example](examples/ruby/ruby.yml) and
  [entrypoint](examples/ruby/evals/run.rb).

  For deterministic comparisons, set `BRAINTRUST_BASE_EXPERIMENT_ID` to an
  experiment ID from the same project's main-branch run. Without it, the API
  selects its normal fallback baseline. The helper reports evaluator errors,
  while the entrypoint decides whether they should fail CI; uncomment the
  example's `exit(1) if result.failed?` policy to make them fatal. Score quality
  thresholds remain an application policy. `terminate_on_failure` is logged and
  ignored because the Ruby SDK has no corresponding mid-eval option.

  An optional follow-up is to move this reporting helper into the Ruby SDK. That
  path would centralize summary fetching, retries, endpoint selection, and JSONL
  serialization, after which applications would no longer need to copy the
  helper. Native action support in this release does not depend on that SDK work.

The action creates or updates a single PR comment with a Braintrust link and a
result table with score and metric sections. To show only selected results, set
`report_scores` and `report_metrics` to their exact names:

```yaml
- uses: braintrustdata/eval-action@v2
  with:
    api_key: ${{ secrets.BRAINTRUST_API_KEY }}
    runtime: node
    report_scores: Levenshtein, Factuality
    report_metrics: |
      Duration
      Cost
```

Each input accepts comma- or newline-separated names and filters its category
independently. When an input is omitted or empty, all results in that category
are included. For example:

### Example Braintrust eval report

**[Say Hi Bot (HEAD-1714341466)](https://www.braintrustdata.com/app/braintrustdata.com/p/Say%20Hi%20Bot/experiments/HEAD-1714341466)**

| Name            | Average    | Improvements | Regressions |
| --------------- | ---------- | -----------: | ----------: |
| **Scores**      |            |              |             |
| Levenshtein     | 83% (+3pp) |         8 🟢 |        4 🔴 |
| **Metrics**     |            |              |             |
| Duration        | 1s (0s)    |        16 🟢 |        1 🔴 |
