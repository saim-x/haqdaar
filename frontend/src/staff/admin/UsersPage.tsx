import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../shared/api/client';
import { errorMessage } from '../../shared/api/errors';
import type { Role, User } from '../../shared/api/types';
import { Card, CardTitle, Chip, ErrorState, Loading, PageHeader } from '../ui';

const ROLES: Role[] = ['CITIZEN', 'HELPER', 'OFFICER', 'ADMIN', 'AUDITOR'];

/** Admin users — docs/11 §6.2.3. Tenant-scoped server-side. */
export default function UsersPage() {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({ full_name: '', email: '', role: 'OFFICER' as Role, password: '' });

  const query = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => api.get<{ items: User[] }>('/admin/users'),
  });

  const create = useMutation({
    mutationFn: () => api.post<User>('/admin/users', form),
    onSuccess: () => {
      setMessage(`Created ${form.full_name}.`);
      setForm({ full_name: '', email: '', role: 'OFFICER', password: '' });
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: (err) => setMessage(errorMessage(err, 'en')),
  });

  const toggle = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      api.patch<User>(`/admin/users/${id}`, { is_active }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
    onError: (err) => setMessage(errorMessage(err, 'en')),
  });

  const changeRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: Role }) => api.patch<User>(`/admin/users/${id}`, { role }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
    onError: (err) => setMessage(errorMessage(err, 'en')),
  });

  if (query.isLoading) return <Loading />;
  if (query.error) return <ErrorState error={query.error} />;

  return (
    <div className="space-y-4">
      <PageHeader title="Users" subtitle="Create accounts, change roles, disable access. Every change is audited." />

      {message && <div className="rounded-lg border border-ink/15 bg-white px-3 py-2 text-xs font-semibold text-ink">{message}</div>}

      <Card>
        <CardTitle>Create user</CardTitle>
        <div className="grid gap-2 sm:grid-cols-5">
          <input
            placeholder="Full name"
            value={form.full_name}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            className="min-h-tap rounded-lg border border-ink/15 px-2 text-xs"
          />
          <input
            placeholder="Email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className="min-h-tap rounded-lg border border-ink/15 px-2 text-xs"
          />
          <select
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
            className="min-h-tap rounded-lg border border-ink/15 px-2 text-xs"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <input
            type="password"
            placeholder="Password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            className="min-h-tap rounded-lg border border-ink/15 px-2 text-xs"
          />
          <button
            type="button"
            onClick={() => create.mutate()}
            disabled={create.isPending || !form.full_name || !form.email}
            className="min-h-tap rounded-lg bg-teal-700 text-xs font-bold text-white disabled:opacity-50"
          >
            Create
          </button>
        </div>
      </Card>

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="border-b border-ink/10 text-[11px] uppercase tracking-wide text-ink-soft">
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Email / phone</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {query.data?.items.map((user) => (
              <tr key={user.id} className="border-b border-ink/5 last:border-0">
                <td className="px-3 py-2 font-semibold text-ink">{user.full_name}</td>
                <td className="px-3 py-2 text-xs text-ink-soft">{user.email ?? user.phone ?? '—'}</td>
                <td className="px-3 py-2">
                  <select
                    value={user.role}
                    onChange={(e) => changeRole.mutate({ id: user.id, role: e.target.value as Role })}
                    className="rounded border border-ink/15 px-1 py-0.5 text-[11px]"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <Chip tone={user.is_active ? 'ok' : 'neutral'}>{user.is_active ? 'active' : 'disabled'}</Chip>
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => toggle.mutate({ id: user.id, is_active: !user.is_active })}
                    className="rounded border border-ink/15 px-2 py-1 text-[11px] font-semibold text-ink-soft hover:bg-ink/5"
                  >
                    {user.is_active ? 'Disable' : 'Enable'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
