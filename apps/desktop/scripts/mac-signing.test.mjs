import * as NodeModule from "node:module";
import { afterEach, expect, it, vi } from "vite-plus/test";

const require = NodeModule.createRequire(import.meta.url);
const builderRequire = NodeModule.createRequire(require.resolve("electron-builder"));
const signingPath = builderRequire.resolve("app-builder-lib/out/codeSign/macCodeSign");
const signingRequire = NodeModule.createRequire(signingPath);
const { createKeychain } = signingRequire(signingPath);
const builderUtil = signingRequire("builder-util");
const builderFs = signingRequire("builder-util/out/fs");
const codesign = signingRequire("./codesign");

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it("uses the keychain password for partition access and certificate passwords for import", async () => {
  vi.stubEnv("TRAVIS", "true");
  const exec = vi.spyOn(builderUtil, "exec").mockResolvedValue("");
  vi.spyOn(builderFs, "unlinkIfExists").mockResolvedValue(undefined);
  vi.spyOn(codesign, "importCertificate").mockImplementation(async (link) => link);

  await createKeychain({
    tmpDir: {},
    cscLink: "application.p12",
    cscKeyPassword: "application-password",
    cscILink: "installer.p12",
    cscIKeyPassword: "installer-password",
    currentDir: "/isolated/signing-fixture",
  });

  const commands = exec.mock.calls.map(([, args]) => args);
  const keychainPassword = commands.find((args) => args[0] === "create-keychain")[2];
  expect(keychainPassword).not.toBe("application-password");
  expect(keychainPassword).not.toBe("installer-password");
  expect(commands.filter((args) => args[0] === "import").map((args) => args.at(-1))).toEqual([
    "application-password",
    "installer-password",
  ]);
  expect(
    commands
      .filter((args) => args[0] === "set-key-partition-list")
      .map((args) => args[args.indexOf("-k") + 1]),
  ).toEqual([keychainPassword, keychainPassword]);
});
