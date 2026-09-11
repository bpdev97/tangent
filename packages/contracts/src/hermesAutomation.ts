import * as Schema from "effect/Schema";

import { ProviderInstanceId } from "./providerInstance.ts";

const NullableText = Schema.NullOr(Schema.String);

export const HermesAutomationRepeat = Schema.Struct({
  times: Schema.NullOr(Schema.Number),
  completed: Schema.Number,
});
export type HermesAutomationRepeat = typeof HermesAutomationRepeat.Type;

export const HermesAutomation = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  prompt: Schema.String,
  schedule: Schema.String,
  enabled: Schema.Boolean,
  state: Schema.String,
  skills: Schema.Array(Schema.String),
  delivery: Schema.Array(Schema.String),
  repeat: HermesAutomationRepeat,
  nextRunAt: NullableText,
  lastRunAt: NullableText,
  lastStatus: NullableText,
  script: NullableText,
  noAgent: Schema.Boolean,
  workdir: NullableText,
});
export type HermesAutomation = typeof HermesAutomation.Type;

export const HermesAutomationHost = Schema.Struct({
  instanceId: ProviderInstanceId,
  displayName: Schema.String,
  profile: Schema.String,
  status: Schema.Literals(["available", "unavailable"]),
  statusMessage: Schema.NullOr(Schema.String),
  automations: Schema.Array(HermesAutomation),
});
export type HermesAutomationHost = typeof HermesAutomationHost.Type;

export const HermesAutomationListResult = Schema.Struct({
  hosts: Schema.Array(HermesAutomationHost),
});
export type HermesAutomationListResult = typeof HermesAutomationListResult.Type;

export const HermesAutomationCreateInput = Schema.Struct({
  action: Schema.Literal("create"),
  instanceId: ProviderInstanceId,
  schedule: Schema.String,
  prompt: Schema.String,
  name: Schema.optionalKey(Schema.String),
  delivery: Schema.optionalKey(Schema.String),
  repeat: Schema.optionalKey(Schema.Number),
  skills: Schema.optionalKey(Schema.Array(Schema.String)),
  script: Schema.optionalKey(Schema.String),
  noAgent: Schema.optionalKey(Schema.Boolean),
  workdir: Schema.optionalKey(Schema.String),
});

export const HermesAutomationUpdateInput = Schema.Struct({
  action: Schema.Literal("update"),
  instanceId: ProviderInstanceId,
  automationId: Schema.String,
  schedule: Schema.optionalKey(Schema.String),
  prompt: Schema.optionalKey(Schema.String),
  name: Schema.optionalKey(Schema.String),
  delivery: Schema.optionalKey(Schema.String),
  repeat: Schema.optionalKey(Schema.Number),
  skills: Schema.optionalKey(Schema.Array(Schema.String)),
  script: Schema.optionalKey(Schema.String),
  noAgent: Schema.optionalKey(Schema.Boolean),
  workdir: Schema.optionalKey(Schema.String),
});

export const HermesAutomationLifecycleInput = Schema.Struct({
  action: Schema.Literals(["pause", "resume", "run", "remove"]),
  instanceId: ProviderInstanceId,
  automationId: Schema.String,
});

export const HermesAutomationMutationInput = Schema.Union([
  HermesAutomationCreateInput,
  HermesAutomationUpdateInput,
  HermesAutomationLifecycleInput,
]);
export type HermesAutomationMutationInput = typeof HermesAutomationMutationInput.Type;

export class HermesAutomationError extends Schema.TaggedError<HermesAutomationError>()(
  "HermesAutomationError",
  {
    message: Schema.String,
    instanceId: Schema.optionalKey(ProviderInstanceId),
    operation: Schema.Literals(["list", "create", "update", "pause", "resume", "run", "remove"]),
  },
) {}
