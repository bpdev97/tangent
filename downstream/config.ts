import { PERSONAL_MOBILE_DISTRIBUTION } from "./mobile-config.ts";
import { PERSONAL_RELEASE_DISTRIBUTION } from "./release-config.ts";

export { PERSONAL_MOBILE_DISTRIBUTION } from "./mobile-config.ts";
export { PERSONAL_RELEASE_DISTRIBUTION } from "./release-config.ts";

export const PERSONAL_DISTRIBUTION = {
  repository: PERSONAL_RELEASE_DISTRIBUTION.repository,
  connect: {
    bootServiceName: "tangent",
    launchdLabel: "com.bpdev97.tangent.service",
  },
  serverRelease: PERSONAL_RELEASE_DISTRIBUTION.serverRelease,
  mobile: PERSONAL_MOBILE_DISTRIBUTION,
  macos: {
    appId: "com.bpdev97.t3code.macos",
    scheme: "bpdev-code",
    developmentScheme: "bpdev-code-dev",
    productName: "Tangent",
    developmentProductName: "Tangent Dev",
    nightlyProductName: "Tangent Nightly",
    artifactName: "tangent-${version}-${arch}.${ext}",
    stateHomeDirectoryName: ".bpdev-code",
    userDataDirectoryName: "bpdev-code",
  },
} as const;
