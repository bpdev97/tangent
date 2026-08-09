export interface GitHubPullRequestLocator {
  readonly owner: string;
  readonly repository: string;
  readonly number: number;
  readonly canonicalUrl: string;
}

export function parseGitHubPullRequestUrl(url: string): GitHubPullRequestLocator | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (
    (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
    parsed.hostname.toLowerCase() !== "github.com"
  ) {
    return null;
  }
  const match = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/.exec(parsed.pathname);
  if (!match) return null;
  const owner = match[1];
  const repository = match[2];
  const number = Number(match[3]);
  if (!owner || !repository || !Number.isSafeInteger(number) || number < 1) return null;
  return {
    owner,
    repository,
    number,
    canonicalUrl: `https://github.com/${owner}/${repository}/pull/${number}`,
  };
}

export function normalizeLinearReviewRepository(repository: string): string | null {
  const normalized = repository
    .trim()
    .replace(/^github\.com\//i, "")
    .replace(/\/+$/g, "");
  return /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(normalized) ? normalized.toLowerCase() : null;
}

export function linearReviewUrlForGitHubPullRequest(
  pullRequestUrl: string,
  reviewRepositories: ReadonlyArray<string>,
): string | null {
  const pullRequest = parseGitHubPullRequestUrl(pullRequestUrl);
  if (pullRequest === null) return null;
  const repository = `${pullRequest.owner}/${pullRequest.repository}`.toLowerCase();
  const eligible = reviewRepositories.some(
    (candidate) => normalizeLinearReviewRepository(candidate) === repository,
  );
  return eligible
    ? `https://linear.review/${pullRequest.owner}/${pullRequest.repository}/pull/${pullRequest.number}`
    : null;
}

export function linearAppUrl(linearUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(linearUrl);
  } catch {
    return null;
  }
  const hostname = parsed.hostname.toLowerCase();
  if (
    parsed.protocol !== "https:" ||
    (hostname !== "linear.app" && hostname !== "linear.review") ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== ""
  ) {
    return null;
  }
  return `linear://${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`;
}
