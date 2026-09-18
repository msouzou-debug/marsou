import { HttpStatus } from "@nestjs/common";
import type { CallHandler, ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { of } from "rxjs";
import { describe, expect, it } from "vitest";
import { MutationInterceptor } from "../src/common/mutation.interceptor";
import { AppError } from "../src/common/errors";

/**
 * R42, the half of it that cannot be shown through HTTP: a mutating route
 * reaching the handler without the row-level-security transaction around it
 * would produce an audit row with no actor. The interceptor refuses instead.
 */
function contextFor(method: string, isPublic = false): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ method, url: "/org-units/x/areas" }) }),
    getHandler: () => ({ isPublic }),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

const handler: CallHandler = { handle: () => of("handled") };

describe("MutationInterceptor", () => {
  const reflector = new Reflector();
  const publicReflector = { getAllAndOverride: () => true } as unknown as Reflector;

  it("refuses a mutating request that is not inside the transaction", () => {
    const interceptor = new MutationInterceptor(reflector);
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      let thrown: unknown;
      try {
        interceptor.intercept(contextFor(method), handler);
      } catch (error) {
        thrown = error;
      }
      expect(thrown, method).toBeInstanceOf(AppError);
      expect((thrown as AppError).getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    }
  });

  it("lets a read through", () => {
    const interceptor = new MutationInterceptor(reflector);
    expect(() => interceptor.intercept(contextFor("GET"), handler)).not.toThrow();
  });

  it("lets a public mutating route through, because it has no caller to record", () => {
    const interceptor = new MutationInterceptor(publicReflector);
    expect(() => interceptor.intercept(contextFor("POST", true), handler)).not.toThrow();
  });
});
