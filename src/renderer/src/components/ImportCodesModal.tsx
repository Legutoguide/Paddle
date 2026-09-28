import { useState, useEffect, useRef } from 'react';
import { Upload, FileText } from 'lucide-react';
import type { ImportPreview, Campaign } from '@shared/types/domain';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';

export function ImportCodesModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState<number | ''>('');
  const [csvContent, setCsvContent] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.api.campaigns.list({ status: 'ACTIVE' }).then(setCampaigns);
  }, []);

  const onFileSelected = async (file: File) => {
    setFileName(file.name);
    const text = await file.text();
    setCsvContent(text);
    setError(null);
    try {
      const p = await window.api.importExport.previewCsv(text);
      setPreview(p);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to read this CSV file');
    }
  };

  const confirmImport = async () => {
    if (!preview || !campaignId) return;
    setImporting(true);
    setError(null);
    try {
      const codes = preview.valid.map((r) => r.code);
      await window.api.importExport.confirmImport({ campaignId, codes });
      toast.show('success', `Imported ${codes.length} valid codes`);
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed. No changes were saved.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal title="Add QR Codes / Import Codes" onClose={onClose} width="max-w-xl">
      <div className="space-y-4">
        <div>
          <label className="label">Target Campaign</label>
          <select className="input" value={campaignId} onChange={(e) => setCampaignId(Number(e.target.value))}>
            <option value="">Select a campaign…</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.campaignName}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">CSV File</label>
          <button
            className="btn-secondary w-full justify-center py-6 border-dashed"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={16} />
            {fileName ? fileName : 'Choose a CSV file with a "code" column'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onFileSelected(file);
            }}
          />
        </div>

        {preview && (
          <div className="rounded-lg border border-base-border bg-base-surface2/60 p-4 text-sm">
            <div className="mb-2 flex items-center gap-2 text-gray-300">
              <FileText size={14} /> Import Summary
            </div>
            <SummaryRow label="Total rows" value={preview.totalRows} />
            <SummaryRow label="Valid" value={preview.valid.length} tone="success" />
            <SummaryRow label="Duplicates in file" value={preview.duplicatesInFile.length} tone="warning" />
            <SummaryRow label="Already in database" value={preview.alreadyExists.length} tone="warning" />
            <SummaryRow label="Invalid" value={preview.invalid.length} tone="danger" />
          </div>
        )}

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-secondary" onClick={onClose} disabled={importing}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={confirmImport}
            disabled={!preview || !campaignId || preview.valid.length === 0 || importing}
          >
            {importing ? 'Importing…' : `Import ${preview?.valid.length ?? 0} Valid Codes`}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function SummaryRow({ label, value, tone }: { label: string; value: number; tone?: 'success' | 'warning' | 'danger' }) {
  const cls = tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : tone === 'danger' ? 'text-danger' : 'text-gray-200';
  return (
    <div className="flex justify-between py-0.5">
      <span className="text-gray-500">{label}</span>
      <span className={cls}>{value}</span>
    </div>
  );
}
