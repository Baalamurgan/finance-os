"use client";

import { useActionState, useEffect, useState } from "react";
import { saveMember, deleteMember } from "@/app/actions";
import { useToast } from "@/components/Toast";

type M = { id: number; name: string; code: string; email: string | null; role: string };

function deriveCode(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return name.trim().slice(0, 2).toUpperCase();
}

export function ManageUsers({
  members,
  householdId,
  currentMemberId,
}: {
  members: M[];
  householdId: number;
  currentMemberId: number;
}) {
  return (
    <div className="space-y-6">
      <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-slate-500">
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Code</th>
              <th className="px-4 py-2">Google email (login)</th>
              <th className="px-4 py-2">Role</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <MemberRow key={m.id} m={m} isSelf={m.id === currentMemberId} />
            ))}
          </tbody>
        </table>
      </section>

      <AddMember householdId={householdId} />
    </div>
  );
}

function MemberRow({ m, isSelf }: { m: M; isSelf: boolean }) {
  const toast = useToast();
  const [name, setName] = useState(m.name);
  const [code, setCode] = useState(m.code);
  const [role, setRole] = useState(m.role);
  const [email, setEmail] = useState(m.email ?? "");

  const [state, formAction, pending] = useActionState(saveMember, { ok: false, n: 0 });
  useEffect(() => {
    if (state.n === 0) return;
    toast(state.ok ? `Saved ${name}` : state.error ?? "Couldn't save", state.ok ? "success" : "error");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.n]);

  const dirty =
    name.trim() !== m.name ||
    code.trim() !== m.code ||
    role !== m.role ||
    email.trim().toLowerCase() !== (m.email ?? "");
  const valid = name.trim().length > 0 && code.trim().length > 0;

  return (
    <tr className="border-b border-slate-100 align-middle">
      <td className="px-4 py-2">
        {/* real <form> carries all values as hidden inputs → reliable submit */}
        <form action={formAction} id={`mf-${m.id}`}>
          <input type="hidden" name="id" value={m.id} />
          <input type="hidden" name="name" value={name} />
          <input type="hidden" name="code" value={code} />
          <input type="hidden" name="email" value={email} />
          <input type="hidden" name="role" value={role} />
        </form>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="input w-32"
        />
      </td>
      <td className="px-4 py-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          className="input w-16"
        />
      </td>
      <td className="px-4 py-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Google email"
          className="input w-48"
        />
      </td>
      <td className="px-4 py-2">
        <select value={role} onChange={(e) => setRole(e.target.value)} className="input">
          <option value="member">member</option>
          <option value="manager">manager</option>
          <option value="head">head</option>
        </select>
      </td>
      <td className="px-4 py-2">
        <div className="flex items-center justify-end gap-2">
          <button
            form={`mf-${m.id}`}
            type="submit"
            disabled={!dirty || !valid || pending}
            className="btn disabled:opacity-40"
          >
            {pending ? "Saving…" : "Save"}
          </button>
          {!isSelf && (
            <form
              action={deleteMember}
              onSubmit={(e) => {
                if (!confirm(`Remove ${m.name} from the family?`)) e.preventDefault();
              }}
            >
              <input type="hidden" name="id" value={m.id} />
              <button
                className="rounded-md px-2 py-2 text-sm text-slate-400 hover:bg-red-50 hover:text-red-600"
                title="Remove"
              >
                Delete
              </button>
            </form>
          )}
        </div>
      </td>
    </tr>
  );
}

function AddMember({ householdId }: { householdId: number }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [role, setRole] = useState("member");

  const [state, formAction, pending] = useActionState(saveMember, { ok: false, n: 0 });
  useEffect(() => {
    if (state.n === 0) return;
    if (state.ok) {
      setName("");
      setEmail("");
      setCode("");
      setRole("member");
      toast("Member added", "success");
    } else {
      toast(state.error ?? "Couldn't add member", "error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.n]);

  const valid = name.trim().length > 0 && email.trim().length > 0;
  const codePlaceholder = name.trim() ? deriveCode(name) : "auto";

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-700">Add member</h2>
      <form action={formAction} className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <input type="hidden" name="householdId" value={householdId} />
        <input
          name="name"
          placeholder="Name *"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="input"
          required
        />
        <input
          name="email"
          type="email"
          placeholder="Google email *"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="input"
          required
        />
        <input
          name="code"
          placeholder={`Code (${codePlaceholder})`}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          className="input"
        />
        <select name="role" value={role} onChange={(e) => setRole(e.target.value)} className="input">
          <option value="member">member</option>
          <option value="manager">manager</option>
          <option value="head">head</option>
        </select>
        <button disabled={!valid || pending} className="btn disabled:opacity-40">
          {pending ? "Adding…" : "Add"}
        </button>
      </form>
      <p className="mt-2 text-xs text-slate-400">
        Code is taken from the name automatically if left blank. Email can&apos;t be changed later.
      </p>
    </section>
  );
}
