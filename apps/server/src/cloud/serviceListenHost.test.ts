import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  HostProcessExecutablePath,
  HostProcessPlatform,
  HostProcessUserId,
} from "@t3tools/shared/hostProcess";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { HttpClient } from "effect/unstable/http";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

import * as ProcessRunner from "../processRunner.ts";
import * as BootService from "./bootService.ts";
import { pinnedRuntimePaths } from "./pinnedRuntime.ts";
import { bootServiceHostOf } from "./serviceListenHost.ts";

const plan = {
  program: ["/home/theo/.t3/runtime/versions/1.2.3/t3", "__service-launcher"],
  baseDir: "/home/theo/.t3",
  logPath: "/home/theo/.t3/userdata/logs/boot-service.log",
  unitPath: "/home/theo/.config/systemd/user/tangent.service",
};
const plistOptions = { homeDir: "/Users/theo", environmentPath: "/usr/bin" };

it("reads the listen address back out of a rendered unit or plist", () => {
  for (const host of ["0.0.0.0", "::", "192.168.1.20"]) {
    expect(bootServiceHostOf(BootService.renderBootServiceUnit({ ...plan, host }))).toBe(host);
    expect(
      bootServiceHostOf(BootService.renderBootServicePlist({ ...plan, host }, plistOptions)),
    ).toBe(host);
  }
  expect(bootServiceHostOf(BootService.renderBootServiceUnit(plan))).toBeUndefined();
  expect(bootServiceHostOf(BootService.renderBootServicePlist(plan, plistOptions))).toBeUndefined();
});

const makeService = Effect.fn("test.make_listen_host_service")(function* (
  home: string,
  cliVersion: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const baseDir = path.join(home, ".t3");
  // The pinned runtime is already on disk, so install only validates it.
  const runtime = pinnedRuntimePaths(path, baseDir, cliVersion, "darwin");
  yield* fs.makeDirectory(path.dirname(runtime.entryPath), { recursive: true });
  yield* fs.writeFileString(runtime.entryPath, "#!/bin/sh\n");
  yield* fs.writeFileString(runtime.sentinelPath, `${cliVersion}\n`);
  const runner = ProcessRunner.ProcessRunner.of({
    run: (input) =>
      Effect.succeed({
        stdout: input.args[0] === "--version" ? `t3 v${cliVersion}\n` : "",
        stderr: "",
        code: ChildProcessSpawner.ExitCode(0),
        timedOut: false,
        stdoutTruncated: false,
        stderrTruncated: false,
        stdoutInvalidUtf8: false,
        stderrInvalidUtf8: false,
      }),
  });
  return yield* BootService.make({
    baseDir,
    logsDir: path.join(baseDir, "userdata", "logs"),
    cliVersion,
    host: { execPath: "/usr/bin/t3" },
  }).pipe(
    Effect.provideService(ProcessRunner.ProcessRunner, runner),
    Effect.provide(
      Layer.mergeAll(
        Layer.succeed(HostProcessPlatform, "darwin"),
        Layer.succeed(HostProcessUserId, 501),
        Layer.succeed(HostProcessExecutablePath, "/usr/bin/t3"),
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make(() => Effect.die("no release download expected")),
        ),
        ConfigProvider.layer(ConfigProvider.fromEnv({ env: { HOME: home, PATH: "/usr/bin" } })),
      ),
    ),
  );
});

it.layer(NodeServices.layer)("service listen address", (it) => {
  it.effect("keeps the listen address through updates until another is chosen", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "t3-listen-host-test-" });

      const initial = yield* makeService(home, "1.2.3");
      yield* initial.install({ host: "0.0.0.0" });
      expect(yield* initial.status).toMatchObject({ current: true, installedHost: "0.0.0.0" });

      // `t3 update` reinstalls with the next version and no host.
      const updated = yield* makeService(home, "1.2.4");
      const plan = yield* updated.install();
      expect(plan.host).toBe("0.0.0.0");
      expect(yield* updated.status).toMatchObject({ current: true, installedHost: "0.0.0.0" });

      yield* updated.install({ host: "127.0.0.1" });
      expect(yield* updated.status).toMatchObject({ current: true, installedHost: "127.0.0.1" });
    }),
  );
});
