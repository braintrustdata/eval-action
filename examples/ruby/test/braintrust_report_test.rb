# frozen_string_literal: true

require "minitest/autorun"
require "ostruct"
require "stringio"
require_relative "../scripts/braintrust_report"

# These transport tests do not load the live SDK or use API keys.
module OpenTelemetry
  module SDK
    module Trace
      module Export
        SUCCESS = 0
      end
    end
  end
end

class BraintrustReportTest < Minitest::Test
  def setup
    @baseline = ENV.delete("BRAINTRUST_BASE_EXPERIMENT_ID")
    @result = OpenStruct.new(experiment_id: "experiment-id", experiment_name: "ci",
      errors: [], scorer_stats: {"Accuracy" => {}})
    @state = OpenStruct.new(api_url: "https://api.example.invalid/", :api_key! => "test-key")
    @provider = Object.new
    def @provider.force_flush(timeout:); 0; end
  end

  def teardown
    if @baseline
      ENV["BRAINTRUST_BASE_EXPERIMENT_ID"] = @baseline
    else
      ENV.delete("BRAINTRUST_BASE_EXPERIMENT_ID")
    end
  end

  def response(code, body)
    klass = Net::HTTPResponse::CODE_TO_OBJ.fetch(code.to_s)
    value = klass.new("1.1", code.to_s, "test")
    value.instance_variable_set(:@read, true)
    value.body = JSON.generate(body)
    value
  end

  def with_http(responses)
    requests = []
    client = Object.new
    client.define_singleton_method(:request) do |request|
      requests << request
      responses.shift || raise("No mocked response")
    end
    Net::HTTP.stub(:start, ->(*_args, &block) { block.call(client) }) { yield requests }
  end

  def test_fetches_server_diffs_with_explicit_baseline_and_emits_jsonl
    ENV["BRAINTRUST_BASE_EXPERIMENT_ID"] = "baseline-id"
    summary = {"experiment_name" => "ci", "scores" => {"Accuracy" => {"score" => 0.9, "diff" => 0.1}}}
    output = StringIO.new
    with_http([response(200, summary)]) do |requests|
      BraintrustCI.report(@result, state: @state, provider: @provider, output: output)
      assert_includes requests.first.path, "summarize_scores=true"
      assert_includes requests.first.path, "comparison_experiment_id=baseline-id"
      assert_equal "Bearer test-key", requests.first["Authorization"]
    end
    assert_equal summary, JSON.parse(output.string)
    refute JSON.parse(output.string).key?("errors")
  end

  def test_retries_transient_errors_and_missing_scores
    summary = {"experiment_name" => "ci", "scores" => {"Accuracy" => {"score" => 1}}}
    with_http([response(429, {}), response(503, {}), response(200, {"scores" => {}}), response(200, summary)]) do |requests|
      BraintrustCI.stub(:sleep, nil) do
        assert_equal summary, BraintrustCI.fetch_summary(@result, @state)
      end
      assert_equal 4, requests.length
    end
  end

  def test_error_record_precedes_summary
    @result.errors = ["task failed"]
    output = StringIO.new
    with_http([response(200, {"experiment_name" => "ci", "scores" => {"Accuracy" => {"score" => 0}}})]) do
      BraintrustCI.report(@result, state: @state, provider: @provider, output: output)
    end
    records = output.string.lines.map { |line| JSON.parse(line) }
    assert_equal({"evaluator_name" => "ci", "errors" => ["task failed"]}, records.first)
    assert_equal "ci", records.last["experiment_name"]
    refute records.last.key?("errors")
  end

  def test_flush_and_output_failures_surface
    def @provider.force_flush(timeout:); 1; end
    Net::HTTP.stub(:start, ->(*) { flunk "must not query before a successful flush" }) do
      assert_raises(RuntimeError) do
        BraintrustCI.report(@result, state: @state, provider: @provider, output: StringIO.new)
      end
    end

    output = StringIO.new
    def output.flush; raise "flush failed"; end
    def @provider.force_flush(timeout:); 0; end
    with_http([response(200, {"scores" => {"Accuracy" => {"score" => 1}}})]) do
      error = assert_raises(RuntimeError) do
        BraintrustCI.report(@result, state: @state, provider: @provider, output: output)
      end
      assert_equal "flush failed", error.message
    end
  end

  def test_auth_errors_are_not_retried_or_copied
    with_http([response(401, {"detail" => "sensitive response"})]) do |requests|
      error = assert_raises(RuntimeError) { BraintrustCI.fetch_summary(@result, @state) }
      assert_equal "Braintrust summary HTTP 401", error.message
      assert_equal 1, requests.length
    end
  end

  def test_missing_scores_stop_after_bounded_retries
    responses = Array.new(8) { response(200, {"scores" => {}}) }
    with_http(responses) do |requests|
      error = BraintrustCI.stub(:sleep, nil) do
        assert_raises(RuntimeError) { BraintrustCI.fetch_summary(@result, @state) }
      end
      assert_match(/missing scores: Accuracy after retries/, error.message)
      assert_equal 8, requests.length
    end
  end

  def test_uses_resolved_custom_api_url_and_supports_no_scores
    @state.api_url = "https://custom.example.invalid/api/"
    @result.scorer_stats = {}
    with_http([response(200, {"experiment_name" => "classifiers", "scores" => {}})]) do |requests|
      BraintrustCI.fetch_summary(@result, @state)
      assert_equal "/api/v1/experiment/experiment-id/summarize?summarize_scores=true", requests.first.path
    end
  end
end
