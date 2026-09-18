import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module";
import { CONFIG, type AppConfig } from "./config";
import { buildOpenApiDocument } from "./openapi-document";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  const config = app.get<AppConfig>(CONFIG);
  app.enableCors({ origin: config.corsOrigins, credentials: true });
  app.enableShutdownHooks();

  // The document is checked into apps/api/openapi.json; serving it here as
  // well means a developer can read it without a build step.
  buildOpenApiDocument(app);

  await app.listen(config.PORT);
}

void bootstrap();
