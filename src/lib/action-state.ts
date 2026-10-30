import type { z } from "zod";

// The result every form Server Action returns to useActionState: a form-level
// message, per-field errors, and the submitted values so a failed form keeps
// what the user typed (React resets uncontrolled forms after an action).

export type ActionState = {
  error?: string;
  ok?: string;
  fieldErrors?: Record<string, string>;
  values?: Record<string, string>;
};

/** FormData → plain strings; repeated names (checkbox groups) are joined with ",". */
export function formValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of formData) {
    if (typeof value !== "string" || key.startsWith("$ACTION")) continue;
    values[key] = key in values ? `${values[key]},${value}` : value;
  }
  return values;
}

export function invalid(error: z.ZodError, values: Record<string, string>, message = "Check the highlighted fields."): ActionState {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) fieldErrors[String(issue.path[0] ?? "form")] ??= issue.message;
  return { error: fieldErrors.form ?? message, fieldErrors, values };
}
