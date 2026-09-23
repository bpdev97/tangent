/**
 * Where Tangent server releases are published. Shared release helpers that
 * mobile also imports read this slice, so mobile never loads the aggregate
 * desktop/server config.
 */
export const PERSONAL_RELEASE_DISTRIBUTION = {
  repository: {
    owner: "bpdev97",
    name: "tangent",
  },
  serverRelease: {
    tagPrefix: "personal-v",
    artifactNamePrefix: "tangent-server",
  },
} as const;
