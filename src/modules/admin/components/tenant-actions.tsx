"use client";

import { Eye, MoreHorizontal, PauseCircle, PlayCircle, UserRoundCog } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

import { impersonateTenant, reactivateTenant, suspendTenant, type ActionState } from "../actions";

type Kind = "club" | "coach";
type Dialog = "suspend" | "reactivate" | "impersonate";

const copy: Record<Dialog, { title: string; body: (name: string, kind: Kind) => string; submit: string }> = {
  suspend: {
    title: "Suspend tenant",
    body: (name, kind) =>
      kind === "coach"
        ? `${name} will be signed out everywhere and can't sign in until reactivated.`
        : `${name} will be marked as suspended. Its members keep their accounts.`,
    submit: "Suspend",
  },
  reactivate: { title: "Reactivate tenant", body: (name) => `${name} will be active again.`, submit: "Reactivate" },
  impersonate: {
    title: "Impersonate",
    body: (name, kind) =>
      `You'll see nexport as ${kind === "club" ? `the owner of ${name}` : name} for up to 1 hour. ` +
      "Account-security changes are blocked while impersonating, and this is recorded in the audit log.",
    submit: "Start impersonating",
  },
};

const actions: Record<Dialog, (state: ActionState, formData: FormData) => Promise<ActionState>> = {
  suspend: suspendTenant,
  reactivate: reactivateTenant,
  impersonate: impersonateTenant,
};

function ConfirmDialog({ dialog, kind, id, name, onClose }: { dialog: Dialog; kind: Kind; id: string; name: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [state, submit, pending] = useActionState(actions[dialog], {});
  const text = copy[dialog];

  return (
    <dialog
      ref={(node) => {
        ref.current = node;
        if (node && !node.open) node.showModal();
      }}
      onClose={onClose}
      aria-labelledby={`${dialog}-${id}-title`}
      className="m-auto w-[min(92vw,28rem)] rounded-2xl border border-border bg-card p-0 text-foreground backdrop:bg-black/40"
    >
      <form action={submit} className="space-y-4 p-6" noValidate>
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="id" value={id} />
        <h2 id={`${dialog}-${id}-title`} className="text-lg font-semibold">
          {text.title}
        </h2>
        <p className="text-sm text-muted-foreground">{text.body(name, kind)}</p>
        {state.ok ? (
          <p role="status" className="rounded-xl bg-success-soft p-3 text-sm text-success">
            {state.ok}
          </p>
        ) : (
          <label className="block text-sm">
            <span className="font-medium">Reason (recorded in the audit log)</span>
            <textarea
              name="reason"
              required
              minLength={5}
              maxLength={500}
              rows={3}
              className="mt-1 w-full resize-none rounded-xl border border-border bg-background p-3 text-sm"
            />
          </label>
        )}
        {state.error && (
          <p role="alert" className="text-sm text-danger">
            {state.error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => ref.current?.close()}>
            {state.ok ? "Close" : "Cancel"}
          </Button>
          {!state.ok && (
            <Button type="submit" size="sm" disabled={pending} className={dialog === "suspend" ? "bg-danger text-white" : undefined}>
              {pending ? "Working…" : text.submit}
            </Button>
          )}
        </div>
      </form>
    </dialog>
  );
}

/** The row's actions dropdown: View details, Suspend/Reactivate, Impersonate. */
export function TenantActions({ kind, id, name, suspended, showView = true }: { kind: Kind; id: string; name: string; suspended: boolean; showView?: boolean }) {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  // Position of the open menu, relative to the viewport. Rows sit inside a
  // horizontally scrolling table, which would clip an absolutely positioned
  // menu; a fixed one escapes it. Closed menus are display:none.
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const menu = useRef<HTMLDetailsElement>(null);
  const open = (d: Dialog) => {
    menu.current?.removeAttribute("open");
    setDialog(d);
  };

  useEffect(() => {
    if (!position) return;
    const close = () => menu.current?.removeAttribute("open");
    window.addEventListener("scroll", close, { capture: true, once: true });
    window.addEventListener("resize", close, { once: true });
    return () => {
      window.removeEventListener("scroll", close, { capture: true });
      window.removeEventListener("resize", close);
    };
  }, [position]);
  const item = "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted";

  return (
    <>
      <details
        ref={menu}
        onToggle={(event) => {
          const details = event.currentTarget;
          if (!details.open) return setPosition(null);
          const rect = details.getBoundingClientRect();
          setPosition({ top: rect.bottom + 4, left: Math.max(8, rect.right - 192) });
        }}
      >
        <summary className="grid size-8 cursor-pointer list-none place-items-center rounded-full hover:bg-muted" aria-label={`Actions for ${name}`}>
          <MoreHorizontal className="size-4" aria-hidden />
        </summary>
        <div
          style={position ?? undefined}
          className={`${position ? "fixed" : "hidden"} z-50 w-48 rounded-xl border border-border bg-card p-1 text-left shadow-lg`}
        >
          {showView && (
            <Link href={`/admin/tenants/${kind}/${id}` as Route} className={item}>
              <Eye className="size-4" aria-hidden /> View details
            </Link>
          )}
          {suspended ? (
            <button type="button" className={item} onClick={() => open("reactivate")}>
              <PlayCircle className="size-4" aria-hidden /> Reactivate tenant
            </button>
          ) : (
            <button type="button" className={`${item} text-danger`} onClick={() => open("suspend")}>
              <PauseCircle className="size-4" aria-hidden /> Suspend tenant
            </button>
          )}
          <button type="button" className={item} disabled={suspended} onClick={() => open("impersonate")}>
            <UserRoundCog className="size-4" aria-hidden /> Impersonate
          </button>
        </div>
      </details>
      {dialog && <ConfirmDialog dialog={dialog} kind={kind} id={id} name={name} onClose={() => setDialog(null)} />}
    </>
  );
}
