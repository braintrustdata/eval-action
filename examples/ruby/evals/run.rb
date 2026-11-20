# frozen_string_literal: true

require "braintrust"
require_relative "../scripts/braintrust_report"

Braintrust.init(blocking_login: true)
$stdout.sync = true

begin
  # Replace this task, data, and scorer with the application's real eval.
  run_id = ENV.fetch("GITHUB_RUN_ID", Time.now.to_i.to_s)
  attempt = ENV.fetch("GITHUB_RUN_ATTEMPT", "1")
  result = Braintrust::Eval.run(
    project: ENV.fetch("BRAINTRUST_PROJECT", "ruby-ci-example"),
    experiment: "uppercase-#{run_id}-#{attempt}",
    cases: [
      {input: "hello", expected: "HELLO"},
      {input: "world", expected: "WORLD"}
    ],
    task: ->(input:) { input.upcase },
    scorers: [
      Braintrust::Scorer.new("exact_match") do |output:, expected:|
        output == expected ? 1.0 : 0.0
      end
    ],
    metadata: {commit: ENV["GITHUB_SHA"], run_id: run_id, run_attempt: attempt},
    quiet: true
  )
  BraintrustCI.report(result)

  # Run and report more experiments here if needed. Each one appears in the
  # same PR comment. To fail CI on evaluator errors, uncomment the next line.
  # exit(1) if result.failed?
ensure
  OpenTelemetry.tracer_provider.shutdown
end
