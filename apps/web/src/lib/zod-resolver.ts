import type { FieldErrors, FieldValues, Resolver } from "react-hook-form";
import type { ZodType } from "zod";

// `@hookform/resolvers` is not a dependency of this app (only `react-hook-form`
// and `zod` themselves are — CONVENTIONS.md "do not add dependencies"), so
// S02a's form (`ProjectForm.tsx`) needs its own small adapter between the
// two rather than pulling in the package that would normally provide
// `zodResolver`. This is that adapter: the same shape and the same job —
// `safeParse` the form values against a zod schema, and hand react-hook-form
// either the parsed (and, per zod, coerced/defaulted) output or a field
// error map built from the schema's issues.
//
// A zod issue's own `message` is used as the field error message verbatim,
// which is why every schema built for this resolver (see
// `screens/s02a-project-form/schema.ts`) sets `message` to an i18n key
// (`forms.*`) rather than an English sentence — the form translates it with
// `t(error.message)` when it renders the field error.
export function zodResolver<T extends FieldValues>(schema: ZodType<T>): Resolver<T> {
  return async (values) => {
    const result = schema.safeParse(values);
    if (result.success) {
      return { values: result.data, errors: {} };
    }
    const errors: FieldErrors<T> = {};
    for (const issue of result.error.issues) {
      // Top-level fields only: every schema this resolver serves is one flat
      // object (react-hook-form registers fields by their top-level name),
      // so the first path segment is the field and a nested path collapses
      // onto it rather than needing react-hook-form's nested-error shape.
      const name = String(issue.path[0] ?? "root") as keyof T;
      if (errors[name]) continue; // first issue per field wins, same as @hookform/resolvers
      errors[name] = { type: issue.code, message: issue.message } as never;
    }
    return { values: {}, errors };
  };
}
