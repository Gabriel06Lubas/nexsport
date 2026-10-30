"use client";

import { createContext, useActionState, useContext, useId, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import type { ActionState } from "@/lib/action-state";
import { cn } from "@/lib/utils";

// A form bound to a Server Action through useActionState. Fields inside it
// read their error and their last submitted value from context, so a server
// page can lay out a form with plain <Field> elements and no client state.
// Validation is the server's job (noValidate): the browser's own checks
// would hide the server's messages and are trivially bypassed anyway.

type Action = (state: ActionState, formData: FormData) => Promise<ActionState>;

const FormState = createContext<{ state: ActionState; pending: boolean }>({ state: {}, pending: false });

export function ActionForm({
  action,
  hidden,
  children,
  className,
  label,
}: {
  action: Action;
  /** Hidden inputs, e.g. { clubSlug, facilityId }. */
  hidden?: Record<string, string>;
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} noValidate aria-label={label} className={className}>
      {hidden && Object.entries(hidden).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
      <FormState.Provider value={{ state, pending }}>{children}</FormState.Provider>
    </form>
  );
}

function useField(name: string, defaultValue?: string) {
  const { state } = useContext(FormState);
  return {
    error: state.fieldErrors?.[name],
    // After a failed submit, keep what the user typed.
    value: state.values && !state.ok ? (state.values[name] ?? "") : defaultValue,
    // Remount the input when the action returns, so defaultValue applies.
    key: `${name}:${state.values ? JSON.stringify(state.values[name] ?? "") : ""}:${state.ok ?? ""}`,
  };
}

const inputClass = "mt-1 h-10 w-full min-w-0 rounded-xl border border-border bg-background px-3 text-sm aria-[invalid=true]:border-danger";

function Hint({ id, error, hint }: { id: string; error?: string; hint?: ReactNode }) {
  if (!error && !hint) return null;
  return (
    <span id={id} className={cn("mt-1 block text-xs", error ? "text-danger" : "text-muted-foreground")}>
      {error ?? hint}
    </span>
  );
}

export function Field({
  name,
  label,
  hint,
  defaultValue,
  className,
  ...input
}: { name: string; label: string; hint?: ReactNode; defaultValue?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "name" | "defaultValue">) {
  const f = useField(name, defaultValue);
  const id = `${useId()}-hint`;
  return (
    <label className={cn("block min-w-0 text-sm", className)}>
      <span className="font-medium">{label}</span>
      <input key={f.key} name={name} defaultValue={f.value} aria-invalid={Boolean(f.error)} aria-describedby={id} className={inputClass} {...input} />
      <Hint id={id} error={f.error} hint={hint} />
    </label>
  );
}

export function SelectField({
  name,
  label,
  options,
  hint,
  defaultValue,
  className,
}: {
  name: string;
  label: string;
  options: readonly { value: string; label: string }[];
  hint?: ReactNode;
  defaultValue?: string;
  className?: string;
}) {
  const f = useField(name, defaultValue);
  const id = `${useId()}-hint`;
  return (
    <label className={cn("block min-w-0 text-sm", className)}>
      <span className="font-medium">{label}</span>
      <select key={f.key} name={name} defaultValue={f.value} aria-invalid={Boolean(f.error)} aria-describedby={id} className={inputClass}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <Hint id={id} error={f.error} hint={hint} />
    </label>
  );
}

export function CheckboxField({ name, label, hint, value = "on", defaultChecked }: { name: string; label: string; hint?: string; value?: string; defaultChecked?: boolean }) {
  const { state } = useContext(FormState);
  const submitted = state.values && !state.ok ? (state.values[name] ?? "").split(",").includes(value) : undefined;
  return (
    <label className="flex items-start gap-2.5 text-sm">
      <input
        key={`${name}:${value}:${String(submitted)}:${state.ok ?? ""}`}
        type="checkbox"
        name={name}
        value={value}
        defaultChecked={submitted ?? defaultChecked}
        className="mt-0.5 size-4 shrink-0 accent-[var(--chart-1)]"
      />
      <span>
        <span className="font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

/** A group of checkboxes sharing one name (repeated values in FormData). */
export function CheckboxGroup({ name, legend, options, defaultValues = [] }: { name: string; legend: string; options: readonly { value: string; label: string }[]; defaultValues?: readonly string[] }) {
  const { state } = useContext(FormState);
  const error = state.fieldErrors?.[name];
  return (
    <fieldset className="min-w-0 text-sm" aria-invalid={Boolean(error)}>
      <legend className="font-medium">{legend}</legend>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
        {options.map((o) => (
          <CheckboxField key={o.value} name={name} value={o.value} label={o.label} defaultChecked={defaultValues.includes(o.value)} />
        ))}
      </div>
      {error && <span className="mt-1 block text-xs text-danger">{error}</span>}
    </fieldset>
  );
}

export function FormFooter({ submit, pendingLabel = "Saving…", variant = "primary" }: { submit: string; pendingLabel?: string; variant?: "primary" | "outline" | "accent" }) {
  const { state, pending } = useContext(FormState);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p aria-live="polite" className="min-h-5 min-w-0 flex-1 text-sm">
        {state.error ? <span className="text-danger">{state.error}</span> : state.ok ? <span className="text-success">{state.ok}</span> : null}
      </p>
      <Button type="submit" size="sm" variant={variant} disabled={pending}>
        {pending ? pendingLabel : submit}
      </Button>
    </div>
  );
}

/** A one-button form (deactivate, mark paid, …) with its result inline. */
export function ActionButton({
  action,
  hidden,
  children,
  pendingLabel,
  variant = "outline",
  confirm,
}: {
  action: Action;
  hidden: Record<string, string>;
  children: ReactNode;
  pendingLabel?: string;
  variant?: "primary" | "outline" | "ghost";
  confirm?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form
      action={formAction}
      className="inline-flex flex-col items-end gap-1"
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Button type="submit" size="sm" variant={variant} disabled={pending} className="h-8 px-3 text-xs">
        {pending ? (pendingLabel ?? "…") : children}
      </Button>
      {(state.error || state.ok) && (
        <span role="status" className={cn("max-w-56 text-right text-xs", state.error ? "text-danger" : "text-success")}>
          {state.error ?? state.ok}
        </span>
      )}
    </form>
  );
}
