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
  [Braintrust API key](https://www.braintrust.dev/docs/welcome/start#create-an-api-key).
- `root`: The root directory containing your evals (defaults to `'.'`). The root
  directory must either have `node` or `python` configured.
- `paths`: Specific paths, relative to the root, containing evals you'd like to
  run.
- `runtime`: Either `node` or `python`
- `use_proxy`: Either `true` or `false`. If set, `OPENAI_BASE_URL` will be set
  to `https://braintrustproxy.com/v1`, which will automatically cache repetitive
  LLM calls and run your evals faster. Defaults to `true`.

## How it works

The action runs `braintrust eval` and collects experiment results, which are
posted as a comment in the PR alongside a link to Braintrust. For example:

### Example braintrust eval report

**[Say Hi Bot (HEAD-1714341466)](https://www.braintrustdata.com/app/braintrustdata.com/p/Say%20Hi%20Bot/experiments/HEAD-1714341466)**

| Score       | Average     | Improvements | Regressions |
| ----------- | ----------- | -----------: | ----------: |
| Levenshtein | 0.83 (+3pp) |         8 🟢 |        4 🔴 |
| Duration    | 1s (0s)     |        16 🟢 |        1 🔴 |

## Example workflow templates

To see examples of fully configured templates, see the `examples` directory:

- [`node with npm`](examples/npm.yml)
- [`node with pnpm`](examples/pnpm.yml)
