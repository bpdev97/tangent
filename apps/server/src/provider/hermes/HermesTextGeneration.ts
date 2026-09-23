/**
 * Commit messages, PR content, branch names, and thread titles through the
 * gateway's stateless `llm.oneshot` method, so they never add turns to a
 * Hermes transcript. Hermes chooses the model for the `t3_code` task from the
 * profile's configuration.
 *
 * `llm.oneshot` runs without tools, so it cannot investigate a checkout:
 * review guides are refused rather than answered blind.
 *
 * @module provider/hermes/HermesTextGeneration
 */
import { TextGenerationError } from "@t3tools/contracts";
import type { ProviderTextGeneration } from "@t3tools/provider-core/server/textGeneration";
import * as TextGenerationOperations from "@t3tools/provider-core/server/textGenerationOperations";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { HermesGatewayUtility } from "./HermesGatewayUtility.ts";

const HERMES_TIMEOUT_MS = 180_000;
const isTextGenerationError = Schema.is(TextGenerationError);

export function makeHermesTextGeneration(
  utility: Pick<HermesGatewayUtility, "generate">,
): ProviderTextGeneration {
  const runJson: TextGenerationOperations.Runner = (request) => {
    const { operation } = request;
    return Effect.gen(function* () {
      const generated = yield* utility.generate(request.prompt).pipe(
        Effect.timeoutOption(HERMES_TIMEOUT_MS),
        Effect.flatMap(
          Option.match({
            onNone: () =>
              Effect.fail(
                new TextGenerationError({ operation, detail: "Hermes request timed out." }),
              ),
            onSome: Effect.succeed,
          }),
        ),
      );
      const trimmed = generated.trim();
      if (!trimmed) {
        return yield* new TextGenerationError({
          operation,
          detail: "Hermes returned empty output.",
        });
      }
      return yield* TextGenerationOperations.decodeJsonReply(request, "Hermes", trimmed);
    }).pipe(
      Effect.mapError((cause) =>
        isTextGenerationError(cause)
          ? cause
          : new TextGenerationError({
              operation,
              detail: "Hermes text generation failed.",
              cause,
            }),
      ),
    );
  };

  return TextGenerationOperations.fromRunner(
    "HermesTextGeneration",
    TextGenerationOperations.withoutInvestigation("Hermes", runJson),
  );
}
