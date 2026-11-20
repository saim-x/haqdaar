import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import { useState } from 'react';
import { admin } from '../../shared/api/endpoints';
import type { Role } from '../../shared/api/types';
import { useAuth } from '../../shared/auth/store';
import { Button } from '../../shared/ui/Button';
import { cx } from '../../shared/ui/cx';
import { Modal } from '../../shared/ui/Modal';
import { PageLoader } from '../../shared/ui/Spinner';
import { ErrorState, Field, inputCls, PageHeader } from '../ui';

const ROLES: Role[] = ['OFFICER', 'ADMIN', 'AUDITOR', 'HELPER'];

export function UsersPage() {
  const { user, tenant } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-users'], queryFn: admin.users });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ full_name: '', email: '', role: 'OFFICER' as Role, password: '' });
  const inv = () => void qc.invalidateQueries({ queryKey: ['admin-users'] });
  const create = useMutation({
    mutationFn: () => admin.createUser(form),
    onSuccess: () => {
      setOpen(false);
      setForm({ full_name: '', email: '', role: 'OFFICER', password: '' });
      inv();
    },
  });
  const patch = useMutation({ mutationFn: (v: { id: string; body: { role?: Role; is_active?: boolean } }) => admin.updateUser(v.id, v.body), onSuccess: inv });

  return (
    <div>
      <PageHeader
        eyebrow="Administration"
        title="Users"
        subtitle={`Staff and helper accounts${tenant ? ` in ${tenant.name}` : ' (platform)'}. Disabling keeps the record for audit; nothing is deleted.`}
        actions={
          <Button size="sm" icon={<UserPlus className="h-4 w-4" aria-hidden />} onClick={() => setOpen(true)}>
            New user
          </Button>
        }
      />
      {q.isLoading ? (
        <PageLoader />
      ) : q.error ? (
        <ErrorState error={q.error} />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <caption className="sr-only">Users</caption>
            <thead className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Role</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {q.data!.map((u) => (
                <tr key={u.id} className={cx(!u.is_active && 'opacity-60')}>
                  <td className="px-3 py-2 font-semibold">
                    {u.full_name}
                    {u.id === user?.id && <span className="ms-2 text-xs text-muted-foreground">(you)</span>}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{u.email ?? '—'}</td>
                  <td className="px-3 py-2">
                    <select
                      className={cx(inputCls, 'w-36')}
                      value={u.role}
                      disabled={u.id === user?.id}
                      onChange={(e) => patch.mutate({ id: u.id, body: { role: e.target.value as Role } })}
                      aria-label={`Role for ${u.full_name}`}
                    >
                      {ROLES.map((r) => (
                        <option key={r}>{r}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <span className={cx('rounded px-1.5 py-0.5 text-xs font-bold', u.is_active ? 'bg-ok-soft text-ok' : 'bg-muted text-muted-foreground')}>{u.is_active ? 'Active' : 'Disabled'}</span>
                  </td>
                  <td className="px-3 py-2 text-end">
                    {u.id !== user?.id && (
                      <Button size="sm" variant={u.is_active ? 'ghost' : 'secondary'} onClick={() => patch.mutate({ id: u.id, body: { is_active: !u.is_active } })}>
                        {u.is_active ? 'Disable' : 'Enable'}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New user"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button loading={create.isPending} disabled={!form.full_name || !form.email || form.password.length < 8} onClick={() => create.mutate()}>
              Create user
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Full name">
            <input className={inputCls} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
          </Field>
          <Field label="Email">
            <input type="email" className={inputCls} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Role">
            <select className={inputCls} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              {ROLES.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </Field>
          <Field label="Temporary password" hint="At least 8 characters. Password managers are supported.">
            <input type="password" autoComplete="new-password" className={inputCls} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>
          {create.error && <ErrorState error={create.error} />}
        </div>
      </Modal>
    </div>
  );
}
