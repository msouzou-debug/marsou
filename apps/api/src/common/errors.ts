import { HttpException, HttpStatus } from "@nestjs/common";

/**
 * Every error the API hands to a user is a key, never a sentence written at
 * the throw site. The exception filter looks the key up in src/i18n/{el,en}
 * against the Accept-Language header, Greek by default (R43).
 */
export class AppError extends HttpException {
  constructor(
    readonly messageKey: string,
    status: HttpStatus,
    readonly params: Record<string, string> = {},
  ) {
    super(messageKey, status);
  }

  static unauthorized(key = "errors.notSignedIn"): AppError {
    return new AppError(key, HttpStatus.UNAUTHORIZED);
  }

  static forbidden(key = "errors.notAllowed"): AppError {
    return new AppError(key, HttpStatus.FORBIDDEN);
  }

  static notFound(key: string, params: Record<string, string> = {}): AppError {
    return new AppError(key, HttpStatus.NOT_FOUND, params);
  }

  static badRequest(key: string, params: Record<string, string> = {}): AppError {
    return new AppError(key, HttpStatus.BAD_REQUEST, params);
  }

  /**
   * The body is well formed but the rule says no — a phase that is not the
   * next one, a gate still open, a baseline somebody tried to move (R04, R06).
   * 400 would say "you typed it wrong", which is not what happened.
   */
  static unprocessable(key: string, params: Record<string, string> = {}): AppError {
    return new AppError(key, HttpStatus.UNPROCESSABLE_ENTITY, params);
  }

  static internal(key = "errors.unexpected"): AppError {
    return new AppError(key, HttpStatus.INTERNAL_SERVER_ERROR);
  }
}
