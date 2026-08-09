import { describe, expect, it } from "vite-plus/test";

import {
  linearAppUrl,
  linearReviewUrlForGitHubPullRequest,
  normalizeLinearReviewRepository,
  parseGitHubPullRequestUrl,
} from "./linear.ts";

describe("Linear pull request destinations", () => {
  it("canonicalizes GitHub pull request URLs", () => {
    expect(parseGitHubPullRequestUrl("https://github.com/Owner/Repo/pull/42/?tab=files")).toEqual({
      owner: "Owner",
      repository: "Repo",
      number: 42,
      canonicalUrl: "https://github.com/Owner/Repo/pull/42",
    });
  });

  it("rejects unsupported or malformed pull request URLs", () => {
    expect(parseGitHubPullRequestUrl("https://gitlab.com/owner/repo/pull/42")).toBeNull();
    expect(parseGitHubPullRequestUrl("https://github.com/owner/repo/issues/42")).toBeNull();
    expect(parseGitHubPullRequestUrl("not a URL")).toBeNull();
  });

  it("normalizes Review repository entries", () => {
    expect(normalizeLinearReviewRepository(" GitHub.com/Owner/Repo/ ")).toBe("owner/repo");
    expect(normalizeLinearReviewRepository("owner")).toBeNull();
  });

  it("creates Review URLs only for explicitly eligible repositories", () => {
    expect(
      linearReviewUrlForGitHubPullRequest("https://github.com/Owner/Repo/pull/42", ["owner/repo"]),
    ).toBe("https://linear.review/Owner/Repo/pull/42");
    expect(
      linearReviewUrlForGitHubPullRequest("https://github.com/Owner/Other/pull/42", ["owner/repo"]),
    ).toBeNull();
  });

  it("creates Linear desktop app deep links from Linear web URLs", () => {
    expect(
      linearAppUrl("https://linear.app/tangent/issue/TAN-42/native-ticket-opening?tab=activity"),
    ).toBe("linear://linear.app/tangent/issue/TAN-42/native-ticket-opening?tab=activity");
  });

  it("does not create Linear app links from untrusted destinations", () => {
    expect(linearAppUrl("https://example.com/tangent/issue/TAN-42")).toBeNull();
    expect(linearAppUrl("linear://linear.app/tangent/issue/TAN-42")).toBeNull();
    expect(linearAppUrl("not a URL")).toBeNull();
  });
});
