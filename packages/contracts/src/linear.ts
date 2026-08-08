import * as Schema from "effect/Schema";

export const LinearTicketDestination = Schema.Struct({
  id: Schema.String,
  identifier: Schema.String,
  title: Schema.String,
  url: Schema.String,
});
export type LinearTicketDestination = typeof LinearTicketDestination.Type;

export const LinearReviewDestination = Schema.Struct({
  url: Schema.String,
});
export type LinearReviewDestination = typeof LinearReviewDestination.Type;

export const LinearPrDestinationResolutionStatus = Schema.Literals([
  "resolved",
  "not_configured",
  "invalid_pr",
  "unauthorized",
  "rate_limited",
  "unreachable",
  "invalid_response",
]);
export type LinearPrDestinationResolutionStatus = typeof LinearPrDestinationResolutionStatus.Type;

export const LinearPrDestinationResolution = Schema.Struct({
  status: LinearPrDestinationResolutionStatus,
  tickets: Schema.Array(LinearTicketDestination),
  review: Schema.NullOr(LinearReviewDestination),
  stale: Schema.Boolean,
  httpStatus: Schema.optional(Schema.Number),
});
export type LinearPrDestinationResolution = typeof LinearPrDestinationResolution.Type;

export const LinearResolvePrDestinationsInput = Schema.Struct({
  prUrl: Schema.String,
  refresh: Schema.optional(Schema.Boolean),
});
export type LinearResolvePrDestinationsInput = typeof LinearResolvePrDestinationsInput.Type;

export const LinearConnectionTestResult = Schema.Struct({
  ok: Schema.Boolean,
  workspaceName: Schema.NullOr(Schema.String),
  failure: Schema.optional(
    Schema.Literals([
      "not_configured",
      "unauthorized",
      "rate_limited",
      "unreachable",
      "invalid_response",
    ]),
  ),
  status: Schema.optional(Schema.Number),
});
export type LinearConnectionTestResult = typeof LinearConnectionTestResult.Type;
