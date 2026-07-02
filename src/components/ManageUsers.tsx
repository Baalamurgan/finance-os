"use client";

import { useState } from "react";
import { saveMember, deleteMember } from "@/app/actions";

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
      <section className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
        {members.map((m) => (
          <MemberRow key={m.id} m={m} isSelf={m.id === currentMemberId} />
        ))}
      </section>

      <AddMember householdId={householdId} />
    </div>
  );
}

function MemberRow({ m, isSelf }: { m: M; isSelf: boolean }) {
  const [name, setName] = useState(m.name);
  const [code, setCode] = useState(m.code);
  const [role, setRole] = useState(m.role);
  const [email, setEmail] = useState(m.email ?? "");

  const dirty =
    name.trim() !== m.name ||
    code.trim() !== m.code ||
    role !== m.role ||
    email.trim().toLowerCase() !== (m.email ?? "");
  const valid = name.trim().length > 0 && code.trim().length > 0;

  return (
    <div className="p-3">
      <form action={saveMember} id={`mf-${m.id}`} />
      <input form={`mf-${m.id}`} type="hidden" name="id" value={m.id} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <label className="flex items-center gap-1 text-xs text-slate-500">
          Name
          <input form={`mf-${m.id}`} name="name" value={name} onChange={(e) => setName(e.target.value)} className="input w-32" />
        </label>
        <label className="flex items-center gap-1 text-xs text-slate-500">
          Code
          <input form={`mf-${m.id}`} name="code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} className="input w-16" />
        </label>
        <label className="flex items-center gap-1 text-xs text-slate-500">
          Email
          <input form={`mf-${m.id}`} name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Google email" className="input w-48" />
        </label>
        <label className="flex items-center gap-1 text-xs text-slate-500">
          Role
          <select form={`mf-${m.id}`} name="role" value={role} onChange={(e) => setRole(e.target.value)} className="input">
            <option value="member">member</option>
            <option value="manager">manager</option>
            <option value="head">head</option>
          </select>
        </label>
        <div className="ml-auto flex items-center gap-2">
          <button form={`mf-${m.id}`} disabled={!dirty || !valid} className="btn disabled:opacity-40">Save</button>
          {!isSelf && (
            <form
              action={deleteMember}
              onSubmit={(e) => {
                if (!confirm(`Remove ${m.name} from the family?`)) e.preventDefault();
              }}
            >
              <input type="hidden" name="id" value={m.id} />
              <button className="rounded-md px-2 py-2 text-sm text-slate-400 hover:bg-red-50 hover:text-red-600" title="Remove">Delete</button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function AddMember({ householdId }: { householdId: number }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");

  const valid = name.trim().length > 0 && email.trim().length > 0;
  const codePlaceholder = name.trim() ? deriveCode(name) : "auto";

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-700">Add member</h2>
      <form
        action={saveMember}
        onSubmit={() => {
          // reset after submit
          setName("");
          setEmail("");
          setCode("");
        }}
        className="grid grid-cols-2 gap-3 sm:grid-cols-5"
      >
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
        <select name="role" defaultValue="member" className="input">
          <option value="member">member</option>
          <option value="manager">manager</option>
          <option value="head">head</option>
        </select>
        <button disabled={!valid} className="btn disabled:opacity-40">
          Add
        </button>
      </form>
      <p className="mt-2 text-xs text-slate-400">
        Code is taken from the name automatically if left blank. Email can&apos;t be changed later.
      </p>
    </section>
  );
}
