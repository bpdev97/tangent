export interface ServerReleaseDistribution {
  readonly repository: {
    readonly owner: string;
    readonly name: string;
  };
  readonly tagPrefix: string;
  readonly artifactNamePrefix: string;
}

export interface ServerReleaseArtifact {
  readonly version: string;
  readonly tag: string;
  readonly artifactName: string;
  readonly checksumName: string;
  readonly artifactUrl: string;
  readonly checksumUrl: string;
}

export function resolveServerReleaseArtifact(
  distribution: ServerReleaseDistribution,
  version: string,
): ServerReleaseArtifact {
  const tag = `${distribution.tagPrefix}${version}`;
  const artifactName = `${distribution.artifactNamePrefix}-${version}.tgz`;
  const checksumName = `${artifactName}.sha256`;
  const releaseBaseUrl =
    `https://github.com/${distribution.repository.owner}/${distribution.repository.name}` +
    `/releases/download/${encodeURIComponent(tag)}`;

  return {
    version,
    tag,
    artifactName,
    checksumName,
    artifactUrl: `${releaseBaseUrl}/${encodeURIComponent(artifactName)}`,
    checksumUrl: `${releaseBaseUrl}/${encodeURIComponent(checksumName)}`,
  };
}
