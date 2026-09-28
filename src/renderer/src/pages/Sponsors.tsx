import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, Users, Archive, ArchiveRestore, Trash2 } from 'lucide-react';
import type { Sponsor } from '@shared/types/domain';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageSpinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { Header } from '@/components/Header';
import { useAuth } from '@/lib/authContext';

export default function Sponsors() {
  const toast = useToast();
  const { can } = useAuth();
  const [sponsors, setSponsors] = useState<Sponsor[] | null>(null);
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<{ type: 'archive' | 'unarchive' | 'delete'; sponsor: Sponsor } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const list = await window.api.sponsors.list({
      search: search || undefined,
      status: showArchived ? 'ARCHIVED' : 'ACTIVE',
    });
    setSponsors(list);
  }, [search, showArchived]);

  useEffect(() => {
    load();
  }, [load]);

  const handleConfirm = async () => {
    if (!confirmTarget) return;
    setBusy(true);
    try {
      if (confirmTarget.type === 'archive') {
        await window.api.sponsors.archive(confirmTarget.sponsor.id);
        toast.show('success', `${confirmTarget.sponsor.name} archived`);
      } else if (confirmTarget.type === 'unarchive') {
        await window.api.sponsors.unarchive(confirmTarget.sponsor.id);
        toast.show('success', `${confirmTarget.sponsor.name} restored`);
      } else {
        await window.api.sponsors.delete(confirmTarget.sponsor.id);
        toast.show('success', `${confirmTarget.sponsor.name} deleted`);
      }
      setConfirmTarget(null);
      await load();
    } catch (err) {
      toast.show('error', err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <Header title="Sponsors" subtitle="Manage the businesses sponsoring your campaigns" />
      {can('sponsors.create') && (
        <div className="flex justify-end">
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            <Plus size={16} /> New Sponsor
          </button>
        </div>
      )}

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            className="input pl-9"
            placeholder="Search sponsors…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-400">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived
        </label>
      </div>

      {sponsors === null ? (
        <PageSpinner />
      ) : sponsors.length === 0 ? (
        <EmptyState
          icon={Users}
          title={showArchived ? 'No archived sponsors' : 'No sponsors yet'}
          description={!showArchived ? 'Create your first sponsor to start building campaigns and coupons.' : undefined}
          action={
            !showArchived && (
              <button className="btn-primary" onClick={() => setShowCreate(true)}>
                <Plus size={16} /> Create Sponsor
              </button>
            )
          }
        />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-base-border bg-base-surface2/50 text-left text-xs text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Notes</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sponsors.map((s) => (
                <tr key={s.id} className="border-b border-base-border last:border-0 hover:bg-base-surface2/40">
                  <td className="px-4 py-3">
                    <Link to={`/sponsors/${s.id}`} className="flex items-center gap-2.5 font-medium text-gray-100 hover:text-accent">
                      {s.logoPath ? (
                        <img src={`file://${s.logoPath}`} alt="" className="h-7 w-7 rounded-md object-cover" />
                      ) : (
                        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-base-surface2 text-[10px] font-semibold text-gray-500">
                          {s.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      {s.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-500 max-w-xs truncate">{s.notes ?? '—'}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={s.status} />
                  </td>
                  <td className="px-4 py-3 text-gray-500">{new Date(s.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1.5">
                      {can('sponsors.edit') &&
                        (s.status === 'ACTIVE' ? (
                          <button
                            className="btn-ghost !px-2 !py-1.5"
                            title="Archive sponsor"
                            onClick={() => setConfirmTarget({ type: 'archive', sponsor: s })}
                          >
                            <Archive size={15} />
                          </button>
                        ) : (
                          <button
                            className="btn-ghost !px-2 !py-1.5"
                            title="Restore sponsor"
                            onClick={() => setConfirmTarget({ type: 'unarchive', sponsor: s })}
                          >
                            <ArchiveRestore size={15} />
                          </button>
                        ))}
                      {can('sponsors.delete') && (
                        <button
                          className="btn-ghost !px-2 !py-1.5 text-danger"
                          title="Delete sponsor"
                          onClick={() => setConfirmTarget({ type: 'delete', sponsor: s })}
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CreateSponsorModal
          onClose={() => setShowCreate(false)}
          onCreated={async () => {
            setShowCreate(false);
            await load();
          }}
        />
      )}

      {confirmTarget && (
        <ConfirmDialog
          title={
            confirmTarget.type === 'archive'
              ? 'Archive sponsor?'
              : confirmTarget.type === 'unarchive'
              ? 'Restore sponsor?'
              : 'Permanently delete sponsor?'
          }
          message={
            confirmTarget.type === 'delete'
              ? `Delete "${confirmTarget.sponsor.name}" permanently? This is only possible if the sponsor has no campaigns or historical data.`
              : confirmTarget.type === 'archive'
              ? `"${confirmTarget.sponsor.name}" will be archived. Its campaigns and history are kept and can be restored later.`
              : `"${confirmTarget.sponsor.name}" will be restored to active.`
          }
          detail={confirmTarget.type === 'delete' ? 'These records may contain historical business data.' : undefined}
          confirmLabel={confirmTarget.type === 'delete' ? 'Delete Permanently' : 'Confirm'}
          danger={confirmTarget.type === 'delete'}
          busy={busy}
          onCancel={() => setConfirmTarget(null)}
          onConfirm={handleConfirm}
        />
      )}
    </div>
  );
}

function CreateSponsorModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [logoPath, setLogoPath] = useState<string | null>(null);
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickLogo = async () => {
    const file = await window.api.settings.pickImage();
    if (file) setLogoPath(file);
  };
  const pickPhoto = async () => {
    const file = await window.api.settings.pickImage();
    if (file) setPhotoPath(file);
  };

  const submit = async () => {
    setError(null);
    if (!name.trim()) {
      setError('Sponsor name is required');
      return;
    }
    setSaving(true);
    try {
      await window.api.sponsors.create({ name: name.trim(), notes: notes.trim() || null, logoPath, photoPath });
      toast.show('success', 'Sponsor created');
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create sponsor');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="New Sponsor" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="label">Sponsor Name</label>
          <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Adam" />
        </div>
        <div>
          <label className="label">Notes (optional)</label>
          <textarea className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Logo (optional)</label>
            <div className="flex items-center gap-2">
              {logoPath ? (
                <img src={`file://${logoPath}`} alt="Logo" className="h-10 w-10 rounded-md object-cover" />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-base-surface2 text-xs text-gray-600">—</div>
              )}
              <button type="button" className="btn-secondary !py-1.5 text-xs" onClick={pickLogo}>
                Choose
              </button>
            </div>
          </div>
          <div>
            <label className="label">Photo (optional)</label>
            <div className="flex items-center gap-2">
              {photoPath ? (
                <img src={`file://${photoPath}`} alt="Photo" className="h-10 w-10 rounded-md object-cover" />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-base-surface2 text-xs text-gray-600">—</div>
              )}
              <button type="button" className="btn-secondary !py-1.5 text-xs" onClick={pickPhoto}>
                Choose
              </button>
            </div>
          </div>
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn-primary" onClick={submit} disabled={saving}>
            {saving ? 'Creating…' : 'Create Sponsor'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
