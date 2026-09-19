import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module";
import { CONFIG, type AppConfig } from "./config";
import { buildOpenApiDocument } from "./openapi-document";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  const config = app.get<AppConfig>(CONFIG);
  app.enableCors({ origin: config.corsOrigins, credentials: true });
  app.enableShutdownHooks();

  // ADR-0018 §5. On the ΟΚΥπΥ server the public hostname is terminated on a
  // separate cloudflared box, which reaches this process over the loopback;
  // the address the client really came from arrives in X-Forwarded-For, and
  // without this Express reports the proxy's address into audit_log.ip for
  // every row. Off by default: trusting the header on a port anybody can
  // reach would let a caller write whatever address it liked into the audit
  // trail. The value is 1 — trust one hop, the proxy in front — rather than
  // `true`, which trusts the whole chain the caller can prepend to.
  if (config.TRUST_PROXY) app.set("trust proxy", 1);

  // The document is checked into apps/api/openapi.json; serving it here as
  // well means a developer can read it without a build step.
  buildOpenApiDocument(app);

  // ADR-0018 §5. Behind cloudflared nothing but the loopback should be able
  // to reach the API, so BIND_HOST=127.0.0.1 on the server. Unset keeps the
  // Nest default of every interface, which is what a developer wants.
  if (config.BIND_HOST) {
    await app.listen(config.PORT, config.BIND_HOST);
  } else {
    await app.listen(config.PORT);
  }
}

void bootstrap();
