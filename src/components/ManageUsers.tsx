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
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
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
  const [name, setName] = useState(m.name);
  const [code, setCode] = useState(m.code);
  const [role, setRole] = useState(m.role);

  const dirty = name.trim() !== m.name || code.trim() !== m.code || role !== m.role;
  const valid = name.trim().length > 0 && code.trim().length > 0;

  return (
    <tr className="border-b border-slate-100 align-middle">
      <td className="px-4 py-2">
        <form action={saveMember} id={`mf-${m.id}`} />
        <input
          form={`mf-${m.id}`}
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="input w-32"
        />
        <input form={`mf-${m.id}`} type="hidden" name="id" value={m.id} />
      </td>
      <td className="px-4 py-2">
        <input
          form={`mf-${m.id}`}
          name="code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          className="input w-16"
        />
      </td>
      <td className="px-4 py-2">
        <span className="text-slate-500">{m.email ?? <em className="text-slate-300">none</em>}</span>
      </td>
      <td className="px-4 py-2">
        <select
          form={`mf-${m.id}`}
          name="role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="input"
        >
          <option value="member">member</option>
          <option value="head">head</option>
        </select>
      </td>
      <td className="px-4 py-2">
        <div className="flex items-center justify-end gap-2">
          <button
            form={`mf-${m.id}`}
            disabled={!dirty || !valid}
            className="btn disabled:opacity-40"
          >
            Save
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
