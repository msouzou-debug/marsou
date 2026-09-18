import { ApiResponse } from "@nestjs/swagger";
import type { ZodType } from "zod";
import { z } from "zod";

/**
 * The response schemas the API publishes are the zod schemas it validates
 * against, converted once. Two sources of truth would drift within a
 * milestone; CAPEX-01 §3 says the zod schemas are shared with the frontend,
 * so they are the ones that count.
 *
 * Draft 2020-12 is what OpenAPI 3.1 uses, which is why the document can carry
 * these verbatim instead of the cut-down 3.0 dialect.
 */
export function jsonSchema(schema: ZodType): Record<string, unknown> {
  const converted = z.toJSONSchema(schema, {
    target: "draft-2020-12",
    io: "output",
    unrepresentable: "any",
  }) as Record<string, unknown>;
  delete converted.$schema;
  return converted;
}

export function ApiZodResponse(status: number, schema: ZodType, description: string) {
  return ApiResponse({ status, description, schema: jsonSchema(schema) as never });
}

export const ErrorResponse = z.object({
  key: z.string().describe("The i18n key of the message, for the client to re-translate."),
  message: z.string().describe("The message in the caller's language; Greek unless asked."),
  requestId: z.string().nullable(),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;

export function ApiZodError(status: number, description: string) {
  return ApiZodResponse(status, ErrorResponse, description);
}
