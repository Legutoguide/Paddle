import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from './Modal';

export interface ConfirmDialogProps {
  title: string;
  message: string;
  detail?: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  /** If set, the confirm button stays disabled until the user types this exact text. */
  requireTypedText?: string;
}

export function ConfirmDialog({
  title,
  message,
  detail,
  confirmLabel = 'Confirm',
  danger = false,
  onConfirm,
  onCancel,
  busy = false,
  requireTypedText,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState('');
  const confirmDisabled = busy || (!!requireTypedText && typed !== requireTypedText);

  return (
    <Modal title={title} onClose={onCancel} width="max-w-md">
      <div className="flex gap-3">
        {danger && (
          <div className="mt-0.5 shrink-0">
            <AlertTriangle className="text-danger" size={20} />
          </div>
        )}
        <div className="flex-1">
          <p className="text-sm text-gray-200">{message}</p>
          {detail && <p className="mt-2 text-xs text-gray-500">{detail}</p>}
          {requireTypedText && (
            <div className="mt-3">
              <label className="mb-1 block text-xs text-gray-500">
                Type <span className="font-mono font-semibold text-danger">{requireTypedText}</span> to confirm
              </label>
              <input
                className="input"
                autoFocus
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={requireTypedText}
              />
            </div>
          )}
        </div>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <button className="btn-secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button className={danger ? 'btn-danger' : 'btn-primary'} onClick={onConfirm} disabled={confirmDisabled}>
          {busy ? 'Working…' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
