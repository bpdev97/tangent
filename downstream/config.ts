import { PERSONAL_MOBILE_DISTRIBUTION } from "./mobile-config.ts";

export { PERSONAL_MOBILE_DISTRIBUTION } from "./mobile-config.ts";

export const PERSONAL_DISTRIBUTION = {
  repository: {
    owner: "bpdev97",
    name: "tangent",
  },
  connect: {
    bootServiceName: "tangent",
    launchdLabel: "com.bpdev97.tangent.service",
    displayName: "Tangent",
  },
  serverRelease: {
    tagPrefix: "personal-v",
    artifactNamePrefix: "tangent-server",
  },
  mobile: PERSONAL_MOBILE_DISTRIBUTION,
  macos: {
    appId: "com.bpdev97.t3code.macos",
    scheme: "bpdev-code",
    developmentScheme: "bpdev-code-dev",
    actionScheme: "bpdev-code-action",
    developmentActionScheme: "bpdev-code-dev-action",
    productName: "Tangent",
    developmentProductName: "Tangent Dev",
    nightlyProductName: "Tangent Nightly",
    artifactName: "tangent-${version}-${arch}.${ext}",
    stateHomeDirectoryName: ".bpdev-code",
    userDataDirectoryName: "bpdev-code",
  },
} as const;
