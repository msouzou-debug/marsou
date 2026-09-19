/**
 * What a PATCH actually asked to change.
 *
 * A zod schema built from the contract carries the defaults the contract
 * declares — `titleEn` defaults to null, and so do `sponsorId`,
 * `projectManagerId` and the two budget years. Parsing `{ "approvedBudget":
 * 310000 }` against `ProjectUpdate` therefore hands back five more keys than
 * the caller sent, all of them null, and a service that wrote them back would
 * quietly wipe the English title of every project somebody edited the budget
 * of.
 *
 * So the service is given the parsed values narrowed to the keys the request
 * body actually carried. A PATCH touches what it names and nothing else,
 * which is what PATCH means.
 */
export function sentKeysOnly<T extends object>(parsed: T, body: unknown): Partial<T> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  const sent = new Set(Object.keys(body as Record<string, unknown>));
  return Object.fromEntries(
    Object.entries(parsed).filter(([key]) => sent.has(key)),
  ) as Partial<T>;
}
