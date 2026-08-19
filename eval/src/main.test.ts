import type { ExperimentSummary } from "braintrust";
import { describe, expect, it } from "vite-plus/test";

import { formatSummary, parseReportNames } from "./main";

const summary: ExperimentSummary = {
  projectName: "Document processing",
  experimentName: "pull-request-123",
  experimentUrl: "https://example.com/experiment",
  scores: {
    Accuracy: {
      name: "Accuracy",
      score: 0.9,
      diff: 0.05,
      improvements: 3,
      regressions: 1,
    },
    Completeness: {
      name: "Completeness",
      score: 0.8,
      improvements: 0,
      regressions: 2,
    },
  },
  metrics: {
    Duration: {
      name: "Duration",
      metric: 1.25,
      unit: "s",
      diff: -0.1,
      improvements: 2,
      regressions: 0,
    },
    Cost: {
      name: "Cost",
      metric: 0.02,
      unit: "$",
      improvements: 0,
      regressions: 0,
    },
  },
};

describe("parseReportNames", () => {
  it("parses comma- and newline-separated names", () => {
    expect(
      parseReportNames(" Accuracy, Duration\nCompleteness,Accuracy "),
    ).toEqual(["Accuracy", "Duration", "Completeness"]);
  });

  it("uses an empty list to report every result in a category", () => {
    expect(parseReportNames("  \n , ")).toEqual([]);
  });
});

describe("formatSummary", () => {
  it("reports scores and metrics in separate tables by default", () => {
    const result = formatSummary(summary);

    expect(result).toContain("Score | Average | Improvements | Regressions");
    expect(result).toContain("Accuracy | 90% (+5pp)");
    expect(result).toContain("Completeness | 80%");
    expect(result).toContain("Metric | Average | Improvements | Regressions");
    expect(result).toContain("Duration | 1.25s (-0.1s)");
    expect(result).toContain("Cost | 0.02$");
    expect(result.indexOf("Metric | Average")).toBeGreaterThan(
      result.indexOf("Completeness | 80%"),
    );
  });

  it("reports only selected scores and metrics", () => {
    const result = formatSummary(summary, {
      scores: ["Accuracy"],
      metrics: ["Duration"],
    });

    expect(result).toContain("Accuracy | 90% (+5pp)");
    expect(result).toContain("Duration | 1.25s (-0.1s)");
    expect(result).not.toContain("Completeness");
    expect(result).not.toContain("Cost");
  });

  it("filters scores and metrics independently", () => {
    const result = formatSummary(summary, { scores: ["Accuracy"] });

    expect(result).not.toContain("Completeness");
    expect(result).toContain("Duration");
    expect(result).toContain("Cost");
  });

  it("keeps the experiment link when no names match", () => {
    expect(
      formatSummary(summary, {
        scores: ["Unknown score"],
        metrics: ["Unknown metric"],
      }),
    ).toBe(
      "**[Document processing (pull-request-123)](https://example.com/experiment)**",
    );
  });
});
