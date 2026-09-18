import type { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import type { OpenAPIObject } from "@nestjs/swagger";

/**
 * CAPEX-01 §3 wants OpenAPI 3.1 checked into the repo. The document is built
 * from the decorators on the controllers, which in turn carry the zod schemas
 * from packages/shared, so it cannot describe a shape the API does not serve.
 * `pnpm --filter @ecapital/api openapi` writes it and a test fails when the
 * checked-in file no longer matches.
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setOpenAPIVersion("3.1.0")
    .setTitle("eCapital API")
    .setDescription(
      "Capital projects and maintenance for ΟΚΥπΥ. M0: sign in, see your own org units and their area tree, read the audit log. Error messages come back in Greek unless Accept-Language asks for English.",
    )
    .setVersion("0.1.0")
    .addBearerAuth({
      type: "http",
      scheme: "bearer",
      bearerFormat: "JWT",
      description: "Entra ID access token, or a development token while DEV_AUTH is on.",
    })
    .addGlobalParameters({
      name: "Accept-Language",
      in: "header",
      required: false,
      schema: { type: "string", default: "el" },
      description: "el or en. Greek when the header is absent.",
    })
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("docs", app, document);
  return document;
}

/** The checked-in form: stable key order, two-space indent, trailing newline. */
export function openApiJson(app: INestApplication): string {
  return `${JSON.stringify(buildOpenApiDocument(app), null, 2)}\n`;
}
