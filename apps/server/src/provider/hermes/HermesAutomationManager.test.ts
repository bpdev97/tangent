import { ProviderInstanceId } from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import {
  buildHermesAutomationArgs,
  projectHermesAutomationJobs,
  resolveHermesAutomationHome,
} from "./HermesAutomationManager.ts";

const instanceId = ProviderInstanceId.make("hermes_research");

describe("Hermes automation projection", () => {
  it("normalizes current and legacy cron job fields without exposing storage details", () => {
    expect(
      projectHermesAutomationJobs({
        jobs: [
          {
            id: "0123456789ab",
            name: null,
            prompt: "Summarize alerts",
            schedule: { value: "0 9 * * *" },
            repeat: { times: 3, completed: 1 },
            enabled: true,
            deliver: "telegram",
            skill: "ops",
            next_run_at: "2026-07-15T13:00:00Z",
            no_agent: false,
          },
          {
            id: "abcdef012345",
            name: "Paused watchdog",
            prompt: null,
            schedule_display: "every 5m",
            enabled: false,
            skills: ["metrics", "metrics", ""],
            deliver: ["local", "slack"],
            script: "watchdog.sh",
            no_agent: true,
            workdir: "/srv/app",
          },
        ],
        updated_at: "2026-08-09T12:00:00Z",
      }),
    ).toEqual([
      {
        id: "0123456789ab",
        name: "Summarize alerts",
        prompt: "Summarize alerts",
        schedule: "0 9 * * *",
        enabled: true,
        state: "scheduled",
        skills: ["ops"],
        delivery: ["telegram"],
        repeat: { times: 3, completed: 1 },
        nextRunAt: "2026-07-15T13:00:00Z",
        lastRunAt: null,
        lastStatus: null,
        script: null,
        noAgent: false,
        workdir: null,
      },
      {
        id: "abcdef012345",
        name: "Paused watchdog",
        prompt: "",
        schedule: "every 5m",
        enabled: false,
        state: "paused",
        skills: ["metrics", "metrics"],
        delivery: ["local", "slack"],
        repeat: { times: null, completed: 0 },
        nextRunAt: null,
        lastRunAt: null,
        lastStatus: null,
        script: "watchdog.sh",
        noAgent: true,
        workdir: "/srv/app",
      },
    ]);
  });

  it("continues to read legacy bare-array cron stores", () => {
    expect(
      projectHermesAutomationJobs([
        {
          id: "legacy-job",
          name: "Legacy job",
          prompt: "Check the legacy store",
          schedule: "every 1h",
        },
      ]),
    ).toHaveLength(1);
  });

  it("rejects a malformed cron store", () => {
    expect(() => projectHermesAutomationJobs({ jobs: "invalid" })).toThrow(
      "Hermes cron store must contain a jobs array.",
    );
  });
});

describe("Hermes automation CLI arguments", () => {
  it("builds create and full edit commands without using a shell", () => {
    expect(
      buildHermesAutomationArgs({
        action: "create",
        instanceId,
        schedule: "every 2h",
        prompt: "Check services",
        name: "Service check",
        delivery: "slack",
        repeat: 5,
        skills: ["ops", "alerts"],
        script: "collect.sh",
        noAgent: true,
        workdir: "/srv/app",
      }),
    ).toEqual([
      "cron",
      "create",
      "every 2h",
      "Check services",
      "--name",
      "Service check",
      "--deliver",
      "slack",
      "--repeat",
      "5",
      "--skill",
      "ops",
      "--skill",
      "alerts",
      "--script",
      "collect.sh",
      "--no-agent",
      "--workdir",
      "/srv/app",
    ]);

    expect(
      buildHermesAutomationArgs({
        action: "update",
        instanceId,
        automationId: "0123456789ab",
        prompt: "Updated prompt",
        skills: [],
        script: "",
        noAgent: false,
        workdir: "",
      }),
    ).toEqual([
      "cron",
      "edit",
      "0123456789ab",
      "--prompt",
      "Updated prompt",
      "--clear-skills",
      "--script",
      "",
      "--agent",
      "--workdir",
      "",
    ]);
  });

  it("builds lifecycle commands and rejects invalid repeat counts", () => {
    expect(
      buildHermesAutomationArgs({
        action: "run",
        instanceId,
        automationId: "0123456789ab",
      }),
    ).toEqual(["cron", "run", "0123456789ab"]);
    expect(() =>
      buildHermesAutomationArgs({
        action: "create",
        instanceId,
        schedule: "every 1h",
        prompt: "Check",
        repeat: 0,
      }),
    ).toThrow("Repeat must be a positive integer.");
  });
});

describe("Hermes automation profile home", () => {
  it.effect("keeps default and named profile stores isolated", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      expect(
        resolveHermesAutomationHome(
          { profile: "default", environment: { HOME: "/home/dev" }, platform: "linux" },
          path,
        ),
      ).toBe("/home/dev/.hermes");
      expect(
        resolveHermesAutomationHome(
          { profile: "Research", environment: { HOME: "/home/dev" }, platform: "linux" },
          path,
        ),
      ).toBe("/home/dev/.hermes/profiles/research");
      expect(
        resolveHermesAutomationHome(
          {
            profile: "research",
            environment: { HERMES_HOME: "/opt/hermes/profiles/research" },
            platform: "linux",
          },
          path,
        ),
      ).toBe("/opt/hermes/profiles/research");
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
