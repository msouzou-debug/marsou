import {
  ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { AppError } from "./errors";
import { INVALID_TEXT_REPRESENTATION, sqlState } from "./sql-error";
import { I18nService } from "./i18n.service";

export interface ErrorBody {
  /** The i18n key, for the frontend to re-translate if it wants to. */
  key: string;
  /** The same thing as a sentence, in the caller's language. */
  message: string;
  requestId: string | null;
}

/**
 * Turns everything thrown inside the API into one shape, with the sentence
 * translated. UI instructions §6: the sentence says what happened and what to
 * do about it, and carries no error code — the code goes in `key`, which is
 * for the developer, not for the reader.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly i18n: I18nService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();
    const locale = this.i18n.resolve(request.headers["accept-language"]);

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let key = "errors.unexpected";
    let params: Record<string, string> = {};

    if (exception instanceof AppError) {
      status = exception.getStatus();
      key = exception.messageKey;
      params = exception.params;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      key = statusKey(status);
    } else if (sqlState(exception) === INVALID_TEXT_REPRESENTATION) {
      // A value the database could not read as its column's type: most often
      // text where an id belongs (24/11/2026, a name typed as a risk owner).
      // That is the caller's input, not a fault here, so 400, not 500.
      status = HttpStatus.BAD_REQUEST;
      key = "errors.badRequest";
    }

    const body: ErrorBody = {
      key,
      message: this.i18n.translate(key, locale, params),
      requestId: stringOrNull((request as Request & { id?: unknown }).id),
    };
    response.status(status).json(body);
  }
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

function statusKey(status: number): string {
  switch (status) {
    case HttpStatus.UNAUTHORIZED:
      return "errors.notSignedIn";
    case HttpStatus.FORBIDDEN:
      return "errors.notAllowed";
    case HttpStatus.NOT_FOUND:
      return "errors.routeNotFound";
    case HttpStatus.BAD_REQUEST:
      return "errors.badRequest";
    default:
      return "errors.unexpected";
  }
}
