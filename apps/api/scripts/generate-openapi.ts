/**
 * Write apps/api/openapi.json from the running Nest metadata.
 *
 *   pnpm --filter @ecapital/api openapi
 *
 * The application is created without listening and without a database
 * connection being used, so this runs anywhere — CI included.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../src/app.module";
import { openApiJson } from "../src/openapi-document";

export const OPENAPI_PATH = join(__dirname, "..", "openapi.json");

export async function generate(): Promise<string> {
  process.env.DEV_AUTH ??= "1";
  process.env.DATABASE_URL ??= "postgres://ecapital@127.0.0.1:5432/ecapital";
  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  await app.init();
  try {
    return openApiJson(app);
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  generate()
    .then((json) => {
      writeFileSync(OPENAPI_PATH, json);
      console.log(`openapi: wrote ${OPENAPI_PATH}`);
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}
