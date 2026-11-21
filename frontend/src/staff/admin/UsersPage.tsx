import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../shared/api/client';
import { errorMessage } from '../../shared/api/errors';
import type { Role, User } from '../../shared/api/types';
import { Card, CardTitle, ErrorState, Loading, PageHeader, roleWord } from '../ui';

const ROLES: Role[] = ['CITIZEN', 'HELPER', 'OFFICER', 'ADMIN', 'AUDITOR'];

/**
 * Admin users — docs/11 §6.2.3. Tenant-scoped server-side.
 *
 * Two surfaces: a create row that stays one line wide, and a ledger of accounts
 * where the role is an inline select and the only destructive action is a
 * hairline button. Nothing here is filled with colour except the status dot.
 */
export default function UsersPage() {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({
    full_name: '',
    email: '',
    role: 'OFFICER' as Role,
    password: '',
  });

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
    mutationFn: ({ id, role }: { id: string; role: Role }) =>
      api.patch<User>(`/admin/users/${id}`, { role }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
    onError: (err) => setMessage(errorMessage(err, 'en')),
  });

  if (query.isLoading) return <Loading />;
  if (query.error) return <ErrorState error={query.error} />;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Users"
        subtitle="Create accounts, change roles, disable access. Every change is audited."
      />

      {message && (
        <div
          role="status"
          className="rounded-control border border-ink/[0.12] bg-card px-4 py-2.5 text-caption text-ink"
        >
          {message}
        </div>
      )}

      <Card>
        <CardTitle>Create user</CardTitle>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_140px_1fr_auto]">
          <input
            placeholder="Full name"
            aria-label="Full name"
            value={form.full_name}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            className="field"
          />
          <input
            placeholder="Email"
            aria-label="Email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className="field"
          />
          <select
            value={form.role}
            aria-label="Role"
            onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
            className="field"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {roleWord(r)}
              </option>
            ))}
          </select>
          <input
            type="password"
            placeholder="Password"
            aria-label="Password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            className="field"
          />
          <button
            type="button"
            onClick={() => create.mutate()}
            disabled={create.isPending || !form.full_name || !form.email}
            className="press min-h-[36px] rounded-control bg-accent px-4 text-caption font-medium text-white hover:bg-accent-ink disabled:cursor-not-allowed disabled:opacity-45"
          >
            Create
          </button>
        </div>
      </Card>

      <Card className="overflow-x-auto p-0">
        <table className="ledger min-w-[760px]">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email / phone</th>
              <th>Role</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {query.data?.items.map((user) => (
              <tr key={user.id}>
                <td className="font-medium text-ink">{user.full_name}</td>
                <td className="text-meta text-ink-2">{user.email ?? user.phone ?? '—'}</td>
                <td>
                  <select
                    value={user.role}
                    aria-label={`Role for ${user.full_name}`}
                    onChange={(e) =>
                      changeRole.mutate({ id: user.id, role: e.target.value as Role })
                    }
                    className="min-h-[30px] rounded-[7px] border border-transparent bg-transparent px-1.5 text-meta text-ink hover:border-ink/[0.12] hover:bg-card focus:border-ink/[0.2] focus:bg-card"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {roleWord(r)}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className={`live-dot ${user.is_active ? 'bg-positive' : 'bg-ink-3'}`}
                      aria-hidden
                    />
                    <span className="text-meta text-ink-2">
                      {user.is_active ? 'active' : 'disabled'}
                    </span>
                  </span>
                </td>
                <td className="text-end">
                  <button
                    type="button"
                    onClick={() => toggle.mutate({ id: user.id, is_active: !user.is_active })}
                    className="press min-h-[30px] rounded-[7px] border border-ink/[0.12] px-2 text-meta text-ink-2 hover:bg-raised hover:text-ink"
                  >
                    {user.is_active ? 'Disable' : 'Enable'}
                  </button>
                </td>
              </tr>
            ))}
            {query.data?.items.length === 0 && (
              <tr>
                <td colSpan={5} className="text-caption text-ink-3">
                  No accounts in this tenant yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
