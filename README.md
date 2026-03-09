# Braintrust eval action

This project enables you to run [Braintrust evals](https://braintrust.dev) as
part of your CI/CD workflow in GitHub, using
[GitHub Actions](https://github.com/features/actions). To use this action,
include the following step in an action file:

```yaml
- name: Run Evals
  uses: braintrustdata/eval-action@v1
  with:
    api_key: ${{ secrets.BRAINTRUST_API_KEY }}
```

## Inputs

- `api_key` (**required**): Your
  [Braintrust API key](https://www.braintrust.dev/app/settings/api-keys).
- `root`: The root directory containing your evals (defaults to `'.'`).
- `paths`: Specific paths or glob patterns, relative to the root, to include.
  Defaults to `'.'` (auto-discovers `*.eval.ts`, `*.eval.js`, `eval_*.py`,
  etc.).
- `runner`: The eval runner binary to use (e.g. `tsx`, `vite-node`, `bun`,
  `python3`). When omitted, `bt` auto-detects from file extensions.
- `use_proxy`: If `true`, sets `OPENAI_BASE_URL` to the Braintrust proxy to
  cache LLM calls. Defaults to `true`.
- `terminate_on_failure`: If `true`, stops on the first eval error. Defaults to
  `false`.
- `bt_version`: Version of the `bt` CLI to install. Leave empty for the latest
  stable release. Pass a semver (e.g. `'0.2.0'`) to pin a version, or a release
  tag (e.g. `'canary-add-glob-support'`) to install a canary build.

> [!NOTE]
> The `runtime` and `package_manager` inputs are deprecated and have no effect.
> Use `runner` instead.

## Full examples

### Node.js (pnpm)

```yaml
name: Run evals

on: push

permissions:
  pull-requests: write
  contents: read

jobs:
  eval:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - uses: pnpm/action-setup@v3
        with:
          version: 10

      - name: Install dependencies
        run: pnpm install
        working-directory: my_eval_dir

      - name: Run Evals
        uses: braintrustdata/eval-action@v1
        with:
          api_key: ${{ secrets.BRAINTRUST_API_KEY }}
          root: my_eval_dir
```

### Python (pip)

```yaml
name: Run evals

on: push

permissions:
  pull-requests: write
  contents: read

jobs:
  eval:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-python@v4
        with:
          python-version: "3.12"

      - name: Install dependencies
        run: pip install -r requirements.txt
        working-directory: my_eval_dir

      - name: Run Evals
        uses: braintrustdata/eval-action@v1
        with:
          api_key: ${{ secrets.BRAINTRUST_API_KEY }}
          root: my_eval_dir
          runner: python3
```

### Python (uv)

```yaml
name: Run evals

on: push

permissions:
  pull-requests: write
  contents: read

jobs:
  eval:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: astral-sh/setup-uv@v5

      - uses: actions/setup-python@v4
        with:
          python-version: "3.12"

      - name: Install dependencies
        run: |
          uv sync --no-dev
          echo "VIRTUAL_ENV=$(pwd)/.venv" >> $GITHUB_ENV
          echo "$(pwd)/.venv/bin" >> $GITHUB_PATH
        working-directory: my_eval_dir

      - name: Run Evals
        uses: braintrustdata/eval-action@v1
        with:
          api_key: ${{ secrets.BRAINTRUST_API_KEY }}
          root: my_eval_dir
          runner: python3
```

> [!IMPORTANT]
> You must specify `permissions` for the action to leave comments on your PR.
> Without these permissions, you'll see GitHub API errors.

For more fully configured templates, see the `examples` directory:

- [`node with npm`](examples/node/npm.yml)
- [`node with pnpm`](examples/node/pnpm.yml)
- [`python with pip`](examples/python/pip.yml)
- [`python with uv`](examples/python/uv.yml)

## How it works

The action installs the [`bt` CLI](https://github.com/braintrustdata/bt) and
runs `bt eval`, collecting experiment results and posting them as a PR comment
with a link to Braintrust. For example:

### Example eval report

**[Say Hi Bot (HEAD-1714341466)](https://www.braintrustdata.com/app/braintrustdata.com/p/Say%20Hi%20Bot/experiments/HEAD-1714341466)**

| Score       | Average     | Improvements | Regressions |
| ----------- | ----------- | -----------: | ----------: |
| Levenshtein | 0.83 (+3pp) |         8 🟢 |        4 🔴 |
| Duration    | 1s (0s)     |        16 🟢 |        1 🔴 |
