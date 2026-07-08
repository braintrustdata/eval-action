# Braintrust eval action

This project enables you to run [Braintrust evals](braintrust.dev) as part of
your CI/CD workflow in Github, using
[Github actions](https://github.com/features/actions). To use this action,
simply include the following step in an action file:

```yaml
- name: Run Evals
  uses: braintrustdata/eval-action@v1
  with:
    api_key: ${{ secrets.BRAINTRUST_API_KEY }}
    runtime: node
```

You can configure the following variables:

- `api_key`: Your
  [Braintrust API key](https://www.braintrust.dev/app/settings/api-keys).
- `root`: The root directory containing your evals (defaults to `'.'`). The root
  directory must have `node`, `python`, or `go` configured.
- `paths`: Specific paths, relative to the root, containing evals you'd like to
  run.
- `runtime`: Either `node`, `python`, or `go`
- `package_manager`: Either `npm` or `pnpm` for a `node` runtime, `pip` or `uv`
  for a `python` runtime, or `go` for a `go` runtime. You can omit this for Go.
- `use_proxy`: Either `true` or `false`. If set, `OPENAI_BASE_URL` will be set
  to `https://braintrustproxy.com/v1`, which will automatically cache repetitive
  LLM calls and run your evals faster. Defaults to `true`.
- `terminate_on_failure`: Either `true` or `false`. If set to `true`, the
  evaluation process will stop when an error occurs. Defaults to `false`.

## Full example

```yaml
name: Run pnpm evals

on:
  push:
    # Uncomment to run only when files in the 'evals' directory change
    # - paths:
    #     - "evals/**"

permissions:
  pull-requests: write
  contents: read

jobs:
  eval:
    name: Run evals
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        id: checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Node.js
        id: setup-node
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - uses: pnpm/action-setup@v3
        with:
          version: 8

      - name: Install Dependencies
        id: install
        run: pnpm install

      - name: Run Evals
        uses: braintrustdata/eval-action@v1
        with:
          api_key: ${{ secrets.BRAINTRUST_API_KEY }}
          runtime: node
          root: my_eval_dir
```

> [!IMPORTANT] You must specify `permissions` for the action to leave comments
> on your PR. Without these permissions, you'll see Github API errors.

To see examples of fully configured templates, see the `examples` directory:

- [`node with npm`](examples/node/npm.yml)
- [`node with pnpm`](examples/node/pnpm.yml)
- [`python with pip`](examples/python/pip.yml)
- [`python with uv`](examples/python/uv.yml)
- [`go`](examples/go/go.yml)

## Go evals

The Go runtime executes `go run ${paths}`. To include Go eval results in the PR
comment, print each `ExperimentSummary` as one JSON line after calling
`result.Summarize(ctx)`:

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

## How it works

For Node and Python, the action runs `braintrust eval`. For Go, the action runs
`go run` on `paths` from `root`. It collects experiment results emitted as JSONL
and posts them as a comment in the PR alongside a link to Braintrust. For example:

### Example braintrust eval report

**[Say Hi Bot (HEAD-1714341466)](https://www.braintrustdata.com/app/braintrustdata.com/p/Say%20Hi%20Bot/experiments/HEAD-1714341466)**

| Score       | Average     | Improvements | Regressions |
| ----------- | ----------- | -----------: | ----------: |
| Levenshtein | 0.83 (+3pp) |         8 🟢 |        4 🔴 |
| Duration    | 1s (0s)     |        16 🟢 |        1 🔴 |
