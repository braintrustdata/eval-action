# frozen_string_literal: true

require "json"
require "net/http"
require "uri"

module BraintrustCI
  # Emit the JSONL contract consumed by eval-action using server-computed
  # comparisons instead of Ruby's local formatting-only Result#summary.
  def self.report(result, state: Braintrust.current_state,
    provider: OpenTelemetry.tracer_provider, output: $stdout)
    raise "A project-backed experiment is required" unless result.experiment_id

    status = provider.force_flush(timeout: 30)
    unless status == OpenTelemetry::SDK::Trace::Export::SUCCESS
      raise "Braintrust telemetry flush failed (status #{status})"
    end

    summary = fetch_summary(result, state)
    unless result.errors.empty?
      output.puts JSON.generate(evaluator_name: result.experiment_name, errors: result.errors)
    end
    output.puts JSON.generate(summary)
    output.flush
  end

  def self.fetch_summary(result, state)
    base_url = state.api_url.sub(%r{/+$}, "")
    uri = URI("#{base_url}/v1/experiment/#{result.experiment_id}/summarize")
    params = {summarize_scores: "true"}
    baseline = ENV["BRAINTRUST_BASE_EXPERIMENT_ID"]
    params[:comparison_experiment_id] = baseline unless baseline.nil? || baseline.empty?
    uri.query = URI.encode_www_form(params)

    # A successful flush can still precede indexing. Retry transient failures
    # and summaries that do not yet contain the evaluator's score names.
    8.times do |attempt|
      request = Net::HTTP::Get.new(uri)
      request["Authorization"] = "Bearer #{state.api_key!}"
      request["Accept"] = "application/json"
      response = Net::HTTP.start(uri.host, uri.port,
        use_ssl: uri.scheme == "https", open_timeout: 10, read_timeout: 30) do |http|
        http.request(request)
      end
      if response.is_a?(Net::HTTPSuccess)
        summary = JSON.parse(response.body)
        expected = result.scorer_stats.keys.map(&:to_s)
        missing = expected - (summary["scores"] || {}).keys
        return normalize_summary(summary) if missing.empty?
        reason = "summary is missing scores: #{missing.join(', ')}"
      elsif [404, 429, 500, 502, 503, 504].include?(response.code.to_i)
        reason = "summary HTTP #{response.code}"
      else
        # Do not copy API response bodies, which may contain application data,
        # into action errors or PR comments.
        raise "Braintrust summary HTTP #{response.code}"
      end
      raise "Braintrust #{reason} after retries" if attempt == 7
      sleep [2**attempt, 8].min
    end
  end

  def self.normalize_summary(summary)
    %w[scores metrics].each do |section|
      (summary[section] || {}).each_value do |value|
        value.delete("diff") if value["diff"].nil?
      end
    end
    summary
  end
end
