import { useEffect, useState } from 'react';
import {
  Save,
  FolderOpen,
  Image as ImageIcon,
  DownloadCloud,
  UploadCloud,
  ListChecks,
  Volume2,
  VolumeX,
  Monitor,
  History as HistoryIcon,
  AlertTriangle,
} from 'lucide-react';
import type { AuditLogEntry } from '@shared/types/domain';
import type { SessionLogEntry, DeviceInfo } from '@/types/window';
import { useSettings } from '@/lib/settingsContext';
import { useToast } from '@/components/ui/Toast';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Header } from '@/components/Header';
import { playSound } from '@/lib/soundService';
import { useAuth } from '@/lib/authContext';
import type { Branch } from '@/types/window';

export default function Settings() {
  const { settings, refresh } = useSettings();
  const { can } = useAuth();
  const toast = useToast();
  const [businessName, setBusinessName] = useState(settings.businessName);
  const [currency, setCurrency] = useState(settings.currency);
  const [defaultExportFolder, setDefaultExportFolder] = useState(settings.defaultExportFolder ?? '');
  const [autoBackupEnabled, setAutoBackupEnabled] = useState(settings.autoBackupEnabled);
  const [autoBackupIntervalDays, setAutoBackupIntervalDays] = useState(settings.autoBackupIntervalDays);
  const [soundsEnabled, setSoundsEnabled] = useState(settings.soundsEnabled);
  const [soundVolume, setSoundVolume] = useState(settings.soundVolume);
  const [saving, setSaving] = useState(false);
  const [restoreFile, setRestoreFile] = useState<string | null>(null);
  const [audit, setAudit] = useState<AuditLogEntry[]>([]);
  const [version, setVersion] = useState('');
  const [sessionLogs, setSessionLogs] = useState<SessionLogEntry[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [newBranchName, setNewBranchName] = useState('');
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [org, setOrg] = useState({
    country: settings.country,
    timezone: settings.timezone,
    dateFormat: settings.dateFormat,
    businessHours: settings.businessHours,
    phone: settings.phone,
    email: settings.email,
    website: settings.website,
    address: settings.address,
    facebookUrl: settings.facebookUrl,
    instagramUrl: settings.instagramUrl,
  });
  const [branding, setBranding] = useState({
    primaryColor: settings.primaryColor,
    secondaryColor: settings.secondaryColor,
    footerContactInfo: settings.footerContactInfo,
  });

  useEffect(() => {
    setBusinessName(settings.businessName);
    setCurrency(settings.currency);
    setDefaultExportFolder(settings.defaultExportFolder ?? '');
    setAutoBackupEnabled(settings.autoBackupEnabled);
    setAutoBackupIntervalDays(settings.autoBackupIntervalDays);
    setSoundsEnabled(settings.soundsEnabled);
    setSoundVolume(settings.soundVolume);
    setOrg({
      country: settings.country,
      timezone: settings.timezone,
      dateFormat: settings.dateFormat,
      businessHours: settings.businessHours,
      phone: settings.phone,
      email: settings.email,
      website: settings.website,
      address: settings.address,
      facebookUrl: settings.facebookUrl,
      instagramUrl: settings.instagramUrl,
    });
    setBranding({
      primaryColor: settings.primaryColor,
      secondaryColor: settings.secondaryColor,
      footerContactInfo: settings.footerContactInfo,
    });
  }, [settings]);

  useEffect(() => {
    window.api.audit.list(20).then(setAudit);
    window.api.app.getVersion().then(setVersion);
    window.api.sessionLogs.list({ limit: 10 }).then(setSessionLogs);
    window.api.branches.list().then(setBranches);
    window.api.deviceInfo.get().then(setDeviceInfo);
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await window.api.settings.update({
        businessName: businessName.trim() || 'My Business',
        currency: currency.trim().toUpperCase() || 'TND',
        defaultExportFolder: defaultExportFolder || null,
        autoBackupEnabled,
        autoBackupIntervalDays,
        soundsEnabled,
        soundVolume,
        ...org,
        ...branding,
      });
      await refresh();
      toast.show('success', 'Settings saved');
    } catch (err) {
      toast.show('error', err instanceof Error ? err.message : 'Unable to save settings');
    } finally {
      setSaving(false);
    }
  };

  const pickExportFolder = async () => {
    const folder = await window.api.settings.pickFolder();
    if (folder) setDefaultExportFolder(folder);
  };

  const pickLogo = async () => {
    const file = await window.api.settings.pickLogo();
    if (file) {
      await window.api.settings.update({ logoPath: file });
      await refresh();
      toast.show('success', 'Logo updated');
    }
  };

  const pickBannerImage = async (field: 'coverBannerPath' | 'dashboardBannerPath' | 'mainPhotoPath', label: string) => {
    const file = await window.api.settings.pickImage();
    if (file) {
      await window.api.settings.update({ [field]: file });
      await refresh();
      toast.show('success', `${label} updated`);
    }
  };

  const createBackup = async () => {
    try {
      const destination = await window.api.backup.pickDestination();
      const result = await window.api.backup.create(destination ?? undefined);
      toast.show('success', `Backup created at ${result.filePath}`);
    } catch (err) {
      toast.show('error', err instanceof Error ? err.message : 'Backup failed');
    }
  };

  const pickRestoreFile = async () => {
    const file = await window.api.backup.pickRestoreFile();
    if (file) setRestoreFile(file);
  };

  const doRestore = async () => {
    if (!restoreFile) return;
    try {
      await window.api.backup.restore(restoreFile);
      toast.show('success', 'Database restored successfully. A safety copy of your previous data was kept.');
      setRestoreFile(null);
      window.location.reload();
    } catch (err) {
      toast.show('error', err instanceof Error ? err.message : 'Restore failed');
      setRestoreFile(null);
    }
  };

  const addBranch = async () => {
    if (!newBranchName.trim()) return;
    try {
      await window.api.branches.create({ name: newBranchName.trim() });
      setNewBranchName('');
      const list = await window.api.branches.list();
      setBranches(list);
      toast.show('success', 'Branch added');
    } catch (err) {
      toast.show('error', err instanceof Error ? err.message : 'Unable to add branch');
    }
  };

  const removeBranch = async (id: number) => {
    try {
      await window.api.branches.delete(id);
      setBranches((prev) => prev.filter((b) => b.id !== id));
      toast.show('success', 'Branch removed');
    } catch (err) {
      toast.show('error', err instanceof Error ? err.message : 'Unable to remove branch');
    }
  };

  const doResetAllData = async () => {
    setResetting(true);
    try {
      const result = await window.api.dangerZone.resetAll();
      toast.show(
        'success',
        `All data reset. A safety backup was saved to ${result.safetyBackupPath}.`
      );
      setShowResetConfirm(false);
      window.location.reload();
    } catch (err) {
      toast.show('error', err instanceof Error ? err.message : 'Reset failed');
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      <Header title="Settings" subtitle={`Prime Paddle v${version || '1.0.0'}`} />

      <section className="card space-y-4 p-5">
        <h2 className="text-sm font-semibold text-gray-200">Business</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Business Name</label>
            <input className="input" value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
          </div>
          <div>
            <label className="label">Currency</label>
            <input className="input" value={currency} onChange={(e) => setCurrency(e.target.value)} maxLength={6} placeholder="TND" />
          </div>
        </div>
        <div>
          <label className="label">Logo</label>
          <div className="flex items-center gap-3">
            {settings.logoPath ? (
              <img src={`file://${settings.logoPath}`} alt="Logo" className="h-10 w-10 rounded-md object-cover" />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-base-surface2 text-gray-600">
                <ImageIcon size={16} />
              </div>
            )}
            <button className="btn-secondary" onClick={pickLogo} disabled={!can('branding.edit')}>
              Choose Logo
            </button>
          </div>
        </div>
      </section>

      {can('organization.view') && (
        <section className="card space-y-4 p-5">
          <h2 className="text-sm font-semibold text-gray-200">Organization</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Country</label>
              <input className="input" value={org.country} onChange={(e) => setOrg({ ...org, country: e.target.value })} disabled={!can('organization.edit')} />
            </div>
            <div>
              <label className="label">Timezone</label>
              <input className="input" value={org.timezone} onChange={(e) => setOrg({ ...org, timezone: e.target.value })} disabled={!can('organization.edit')} />
            </div>
            <div>
              <label className="label">Date Format</label>
              <select className="input" value={org.dateFormat} onChange={(e) => setOrg({ ...org, dateFormat: e.target.value })} disabled={!can('organization.edit')}>
                <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                <option value="YYYY-MM-DD">YYYY-MM-DD</option>
              </select>
            </div>
            <div>
              <label className="label">Business Hours</label>
              <input className="input" value={org.businessHours} onChange={(e) => setOrg({ ...org, businessHours: e.target.value })} placeholder="e.g. 9am - 6pm" disabled={!can('organization.edit')} />
            </div>
            <div>
              <label className="label">Phone</label>
              <input className="input" value={org.phone} onChange={(e) => setOrg({ ...org, phone: e.target.value })} disabled={!can('organization.edit')} />
            </div>
            <div>
              <label className="label">Email</label>
              <input className="input" value={org.email} onChange={(e) => setOrg({ ...org, email: e.target.value })} disabled={!can('organization.edit')} />
            </div>
            <div>
              <label className="label">Website</label>
              <input className="input" value={org.website} onChange={(e) => setOrg({ ...org, website: e.target.value })} disabled={!can('organization.edit')} />
            </div>
            <div>
              <label className="label">Address</label>
              <input className="input" value={org.address} onChange={(e) => setOrg({ ...org, address: e.target.value })} disabled={!can('organization.edit')} />
            </div>
            <div>
              <label className="label">Facebook URL</label>
              <input className="input" value={org.facebookUrl} onChange={(e) => setOrg({ ...org, facebookUrl: e.target.value })} disabled={!can('organization.edit')} />
            </div>
            <div>
              <label className="label">Instagram URL</label>
              <input className="input" value={org.instagramUrl} onChange={(e) => setOrg({ ...org, instagramUrl: e.target.value })} disabled={!can('organization.edit')} />
            </div>
          </div>
        </section>
      )}

      {can('branches.view') && (
        <section className="card space-y-4 p-5">
          <h2 className="text-sm font-semibold text-gray-200">Branches</h2>
          <p className="text-[11px] text-gray-600">
            A local tag/category for this device only (e.g. "Tunis", "Sousse") — not multi-device sync.
          </p>
          {branches.length === 0 ? (
            <p className="text-xs text-gray-500">No branches yet.</p>
          ) : (
            <div className="space-y-1.5">
              {branches.map((b) => (
                <div key={b.id} className="flex items-center justify-between rounded-lg bg-base-surface2/50 px-3 py-2 text-sm">
                  <span className="text-gray-200">{b.name}</span>
                  {can('branches.delete') && (
                    <button className="text-xs text-danger hover:underline" onClick={() => removeBranch(b.id)}>
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {can('branches.create') && (
            <div className="flex gap-2">
              <input
                className="input"
                placeholder="e.g. Tunis"
                value={newBranchName}
                onChange={(e) => setNewBranchName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addBranch()}
              />
              <button className="btn-secondary shrink-0" onClick={addBranch}>
                Add Branch
              </button>
            </div>
          )}
        </section>
      )}

      {can('branding.view') && (
        <section className="card space-y-4 p-5">
          <h2 className="text-sm font-semibold text-gray-200">Business Branding</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Primary Color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  className="h-9 w-12 rounded border border-base-border bg-base-surface2"
                  value={branding.primaryColor}
                  onChange={(e) => setBranding({ ...branding, primaryColor: e.target.value })}
                  disabled={!can('branding.edit')}
                />
                <input className="input" value={branding.primaryColor} onChange={(e) => setBranding({ ...branding, primaryColor: e.target.value })} disabled={!can('branding.edit')} />
              </div>
            </div>
            <div>
              <label className="label">Secondary Color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  className="h-9 w-12 rounded border border-base-border bg-base-surface2"
                  value={branding.secondaryColor}
                  onChange={(e) => setBranding({ ...branding, secondaryColor: e.target.value })}
                  disabled={!can('branding.edit')}
                />
                <input className="input" value={branding.secondaryColor} onChange={(e) => setBranding({ ...branding, secondaryColor: e.target.value })} disabled={!can('branding.edit')} />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <BannerPicker
              label="Cover Banner"
              path={settings.coverBannerPath}
              onPick={() => pickBannerImage('coverBannerPath', 'Cover banner')}
              disabled={!can('branding.edit')}
            />
            <BannerPicker
              label="Dashboard Banner"
              path={settings.dashboardBannerPath}
              onPick={() => pickBannerImage('dashboardBannerPath', 'Dashboard banner')}
              disabled={!can('branding.edit')}
            />
            <BannerPicker
              label="Main Business Photo"
              path={settings.mainPhotoPath}
              onPick={() => pickBannerImage('mainPhotoPath', 'Main photo')}
              disabled={!can('branding.edit')}
            />
          </div>

          <div>
            <label className="label">Footer / Contact Info (used in PDF exports and print sheets)</label>
            <textarea
              className="input"
              rows={2}
              value={branding.footerContactInfo}
              onChange={(e) => setBranding({ ...branding, footerContactInfo: e.target.value })}
              disabled={!can('branding.edit')}
            />
          </div>
        </section>
      )}

      <section className="card space-y-4 p-5">
        <h2 className="text-sm font-semibold text-gray-200">Exports</h2>
        <div>
          <label className="label">Default Export Folder</label>
          <div className="flex gap-2">
            <input className="input" value={defaultExportFolder} placeholder="Documents/SponsorQR Exports" readOnly />
            <button className="btn-secondary shrink-0" onClick={pickExportFolder}>
              <FolderOpen size={15} /> Browse
            </button>
          </div>
        </div>
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="text-sm font-semibold text-gray-200">Backup & Restore</h2>
        <label className="flex items-center gap-2 text-sm text-gray-400">
          <input type="checkbox" checked={autoBackupEnabled} onChange={(e) => setAutoBackupEnabled(e.target.checked)} />
          Automatic backups
        </label>
        {autoBackupEnabled && (
          <div className="flex items-center gap-2 text-sm text-gray-400">
            Every
            <input
              className="input w-20"
              type="number"
              min={1}
              value={autoBackupIntervalDays}
              onChange={(e) => setAutoBackupIntervalDays(Number(e.target.value))}
            />
            days
          </div>
        )}
        <div className="flex gap-2 pt-2">
          <button className="btn-secondary" onClick={createBackup} disabled={!can('backup.create')}>
            <DownloadCloud size={15} /> Backup Database Now
          </button>
          <button className="btn-secondary" onClick={pickRestoreFile} disabled={!can('backup.restore')}>
            <UploadCloud size={15} /> Restore from Backup…
          </button>
        </div>
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-200">
          {soundsEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />} Sounds
        </h2>
        <label className="flex items-center gap-2 text-sm text-gray-400">
          <input
            type="checkbox"
            checked={soundsEnabled}
            onChange={(e) => setSoundsEnabled(e.target.checked)}
          />
          Play sounds for scan/validate results and notifications
        </label>
        {soundsEnabled && (
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500">Volume</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={soundVolume}
              onChange={(e) => setSoundVolume(Number(e.target.value))}
              className="w-48 accent-accent"
            />
            <button
              className="btn-ghost !py-1 !px-2 text-xs"
              onClick={() => playSound('success')}
              title="Test sound"
            >
              Test
            </button>
          </div>
        )}
      </section>

      <div className="flex justify-end">
        <button className="btn-primary" onClick={save} disabled={saving || !can('settings.edit')}>
          <Save size={15} /> {saving ? 'Saving…' : 'Save Settings'}
        </button>
      </div>

      <section className="card space-y-3 p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-200">
          <Monitor size={15} /> This Device
        </h2>
        {!deviceInfo ? (
          <p className="text-xs text-gray-500">Loading…</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 text-xs">
            <Row label="Device Name" value={deviceInfo.deviceName} />
            <Row label="Platform" value={deviceInfo.platform} />
            <Row label="Architecture" value={deviceInfo.arch} />
            <Row label="App Version" value={deviceInfo.appVersion} />
            <Row label="CPU Cores" value={String(deviceInfo.cpus)} />
            <Row label="Memory" value={`${deviceInfo.totalMemoryGB} GB`} />
            <Row label="Database Path" value={deviceInfo.databasePath} mono wide />
          </div>
        )}
        <p className="text-[11px] text-gray-600">
          This app runs entirely on this single device — there is no multi-device or cloud sync.
        </p>
      </section>

      <section className="card space-y-3 p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-200">
          <HistoryIcon size={15} /> Session Log
        </h2>
        <p className="text-[11px] text-gray-600">
          This app has no user accounts, so this tracks real app-launch events on this device only.
        </p>
        {sessionLogs.length === 0 ? (
          <p className="text-xs text-gray-500">No sessions recorded yet.</p>
        ) : (
          <div className="max-h-48 overflow-y-auto text-xs">
            {sessionLogs.map((s) => (
              <div key={s.id} className="flex justify-between border-b border-base-border/50 py-1.5 last:border-0">
                <span className="text-gray-400">
                  {s.deviceName} · v{s.appVersion} · {s.platform}
                </span>
                <span className="text-gray-600">{new Date(s.startedAt).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card space-y-3 p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-200">
          <ListChecks size={15} /> Recent Activity (Audit Log)
        </h2>
        {audit.length === 0 ? (
          <p className="text-xs text-gray-500">No activity recorded yet.</p>
        ) : (
          <div className="max-h-64 overflow-y-auto text-xs">
            {audit.map((a) => (
              <div key={a.id} className="flex justify-between border-b border-base-border/50 py-1.5 last:border-0">
                <span className="text-gray-400">{a.action.replace(/_/g, ' ')}</span>
                <span className="text-gray-600">{new Date(a.createdAt).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {can('danger_zone.access') && (
        <section className="card space-y-4 border-danger/30 p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-danger">
            <AlertTriangle size={15} /> Danger Zone
          </h2>
          <div className="rounded-lg border border-danger/30 bg-danger/5 p-4">
            <p className="text-sm font-medium text-gray-200">Reset All Data</p>
            <p className="mt-1 text-xs text-gray-500">
              Permanently deletes every sponsor, campaign, QR code and usage record. A safety backup is
              created automatically first, but this action cannot be undone from within the app.
            </p>
            <button
              className="btn-danger mt-3"
              onClick={() => setShowResetConfirm(true)}
              disabled={!can('danger_zone.execute')}
              title={!can('danger_zone.execute') ? 'Only the CEO can execute this' : undefined}
            >
              Reset All Data
            </button>
          </div>
        </section>
      )}

      {restoreFile && (
        <ConfirmDialog
          title="Restore database?"
          message="This will replace all current data with the contents of the selected backup file."
          detail="A safety copy of your current data will be created automatically before restoring, in case anything goes wrong."
          confirmLabel="Restore"
          danger
          onCancel={() => setRestoreFile(null)}
          onConfirm={doRestore}
        />
      )}

      {showResetConfirm && (
        <ConfirmDialog
          title="Reset all data?"
          message="This permanently erases all sponsors, campaigns, QR codes and history. A safety backup is created automatically before proceeding."
          confirmLabel="Reset All Data"
          danger
          busy={resetting}
          requireTypedText="DELETE"
          onCancel={() => setShowResetConfirm(false)}
          onConfirm={doResetAllData}
        />
      )}
    </div>
  );
}

function Row({ label, value, mono, wide }: { label: string; value: string; mono?: boolean; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2' : ''}>
      <p className="text-gray-500">{label}</p>
      <p className={`mt-0.5 truncate text-gray-200 ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  );
}

function BannerPicker({
  label,
  path,
  onPick,
  disabled,
}: {
  label: string;
  path: string | null;
  onPick: () => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex flex-col items-center gap-2">
        {path ? (
          <img src={`file://${path}`} alt={label} className="h-20 w-full rounded-lg border border-base-border object-cover" />
        ) : (
          <div className="flex h-20 w-full items-center justify-center rounded-lg border border-dashed border-base-border bg-base-surface2/40 text-xs text-gray-600">
            No image set
          </div>
        )}
        <button className="btn-secondary w-full !py-1.5 text-xs" onClick={onPick} disabled={disabled}>
          Choose Image
        </button>
      </div>
    </div>
  );
}
