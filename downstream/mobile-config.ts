/**
 * Mobile-only Tangent distribution inputs. Expo fingerprints every module
 * imported by app.config.ts, so this slice must not import the aggregate
 * desktop/server config: desktop URL-handler changes are OTA-compatible.
 */
export const PERSONAL_MOBILE_DISTRIBUTION = {
  appName: "Tangent",
  developmentAppName: "Tangent Dev",
  previewAppName: "Tangent Preview",
  scheme: "bpdev-code",
  developmentScheme: "bpdev-code-dev",
  previewScheme: "bpdev-code-preview",
  expoOwner: "bpdev97",
  expoSlug: "t3-code-personal",
  expoProjectId: "8c5853ac-04f2-4d67-9f59-a699cb3c9776",
  iosBundleIdentifier: "com.bpdev97.t3code.ios",
  appleTeamId: "BL9B7SKPHX",
} as const;
