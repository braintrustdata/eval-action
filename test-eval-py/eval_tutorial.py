from braintrust import Eval

from autoevals import Levenshtein

Eval(
    "Say Hi Bot Python",  # Replace with your project name
    data=lambda: [
        {
            "input": "Foo",
            "expected": "Hi Foo",
        },
        {
            "input": "Bar",
            "expected": "Hello Bar",
        },
    ],  # Replace with your eval dataset
    task=lambda input: "Hi " + input,  # Replace with your LLM call
    scores=[Levenshtein],
)
