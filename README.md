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
> You must specify `permissions` for the action to leave comments
> on your PR. Without these permissions, you'll see GitHub API errors.

## Inputs

| Input                  | Required | Description                                                                                                                                                 |
| ---------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api_key`              | Yes      | Your [Braintrust API key](https://www.braintrust.dev/app/settings/api-keys).                                                                                |
| `runtime`              | Yes      | The runtime to use: `node`, `python`, or `go`.                                                                                                              |
| `root`                 | No       | Root directory containing your evals. Defaults to `.`.                                                                                                      |
| `paths`                | No       | Paths or glob patterns, relative to `root`, containing evals to run. Defaults to `.`.                                                                       |
| `package_manager`      | No       | `npm` or `pnpm` for Node; `pip` or `uv` for Python; `go` for Go. Can be omitted for the default package manager.                                            |
| `use_proxy`            | No       | Set to `true` to use the Braintrust proxy at `https://braintrustproxy.com/v1`, which can cache repetitive LLM calls and speed up evals. Defaults to `true`. |
| `terminate_on_failure` | No       | Set to `true` to stop the eval process when an error occurs. Defaults to `false`. Ignored for Go evals.                                                     |
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

The action creates or updates a single PR comment with a Braintrust link and
result table. For example:

### Example Braintrust eval report

**[Say Hi Bot (HEAD-1714341466)](https://www.braintrustdata.com/app/braintrustdata.com/p/Say%20Hi%20Bot/experiments/HEAD-1714341466)**

| Score       | Average    | Improvements | Regressions |
| ----------- | ---------- | -----------: | ----------: |
| Levenshtein | 83% (+3pp) |         8 🟢 |        4 🔴 |
| Duration    | 1s (0s)    |        16 🟢 |        1 🔴 |
