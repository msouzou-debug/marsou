import type { ZodType } from "zod";

// ADR-0005: the frontend only ever talks to /api/..., through this
// fetcher. When NestJS lands, NEXT_PUBLIC_API_BASE moves and this file is
// the only thing that changes (R15: swappable cost/data source).
const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiFetch<T>(path: string, schema: ZodType<T>): Promise<T> {
  const res = await fetch(`${API_BASE}/api${path}`);
  if (!res.ok) {
    throw new ApiError(`Request to ${path} failed with ${res.status}`, res.status);
  }
  const json = await res.json();
  return schema.parse(json);
}
