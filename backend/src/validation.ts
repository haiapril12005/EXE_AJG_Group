import { z } from "zod";
import { HttpError } from "./errors";

/** Returns the parsed output, so `.default()` and `.transform()` values are typed as applied. */
export function parseBody<S extends z.ZodTypeAny>(schema: S, body: unknown): z.output<S> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new HttpError(400, parsed.error.issues.map((issue) => issue.message).join("; "));
  }
  return parsed.data;
}
