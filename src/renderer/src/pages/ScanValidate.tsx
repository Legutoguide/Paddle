import { useState, useCallback, useRef } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ScanLine, CheckCircle2, XCircle, Clock, Ban, PartyPopper, KeyboardIcon, Lock } from 'lucide-react';
import type { ValidationResult } from '@shared/types/domain';
import { ScannerCamera } from '@/components/ScannerCamera';
import { useSettings } from '@/lib/settingsContext';
import { useToast } from '@/components/ui/Toast';
import { playSound } from '@/lib/soundService';

type ScreenState =
  | { mode: 'IDLE' }
  | { mode: 'RESULT'; result: ValidationResult }
  | { mode: 'CONFIRMING' }
  | { mode: 'SUCCESS'; code: string; sponsorName: string; finalPriceCents: number; discountPercentage: number; usedAt: string };

export default function ScanValidate() {
  const { formatMoney } = useSettings();
  const toast = useToast();
  const [screen, setScreen] = useState<ScreenState>({ mode: 'IDLE' });
  const [manualCode, setManualCode] = useState('');
  const [scannerActive, setScannerActive] = useState(true);
  const validatingRef = useRef(false);

  const runValidate = useCallback(async (code: string) => {
    if (validatingRef.current) return;
    const trimmed = code.trim();
    if (!trimmed) return;
    validatingRef.current = true;
    try {
      const result = await window.api.coupons.validate(trimmed);
      setScreen({ mode: 'RESULT', result });
      if (result.outcome === 'VALID') playSound('notification');
      else if (result.outcome === 'EXPIRED' || result.outcome === 'RESERVED') playSound('warning');
      else playSound('error'); // INVALID, USED, REVOKED
    } catch (err) {
      toast.show('error', err instanceof Error ? err.message : 'Validation failed');
    } finally {
      validatingRef.current = false;
    }
  }, [toast]);

  const confirmUse = async () => {
    if (screen.mode !== 'RESULT' || screen.result.outcome !== 'VALID') return;
    const coupon = screen.result.coupon;
    setScreen({ mode: 'CONFIRMING' });
    try {
      const { usedAt } = await window.api.coupons.confirmUse(coupon.code);
      playSound('success');
      setScreen({
        mode: 'SUCCESS',
        code: coupon.code,
        sponsorName: coupon.sponsorName,
        finalPriceCents: coupon.finalPriceCents,
        discountPercentage: coupon.discountPercentage,
        usedAt,
      });
    } catch (err) {
      playSound('error');
      toast.show('error', err instanceof Error ? err.message : 'This coupon could not be used.');
      setScreen({ mode: 'IDLE' });
    }
  };

  const reset = () => {
    setManualCode('');
    setScreen({ mode: 'IDLE' });
  };

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="text-center">
        <h1 className="text-xl font-semibold text-gray-100">Scan / Validate</h1>
        <p className="text-sm text-gray-500">Scan a customer's QR code or enter it manually</p>
      </div>

      {screen.mode === 'IDLE' && (
        <div className="space-y-5">
          <ScannerCamera active={scannerActive} onDetect={runValidate} />

          <div className="flex items-center gap-3 text-xs text-gray-600">
            <div className="h-px flex-1 bg-base-border" />
            OR ENTER CODE MANUALLY
            <div className="h-px flex-1 bg-base-border" />
          </div>

          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              runValidate(manualCode);
            }}
          >
            <div className="relative flex-1">
              <KeyboardIcon size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                className="input pl-9 text-center font-mono tracking-wide"
                placeholder="ADAM-X7K29"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value.toUpperCase())}
                autoFocus
              />
            </div>
            <button type="submit" className="btn-primary px-6">
              Validate
            </button>
          </form>
        </div>
      )}

      {screen.mode === 'RESULT' && (
        <ResultCard result={screen.result} onConfirm={confirmUse} onBack={reset} formatMoney={formatMoney} />
      )}

      {screen.mode === 'CONFIRMING' && (
        <div className="card flex flex-col items-center gap-3 p-10 text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          <p className="text-sm text-gray-400">Confirming…</p>
        </div>
      )}

      {screen.mode === 'SUCCESS' && (
        <div className="card flex flex-col items-center gap-2 p-10 text-center">
          <div className="mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-success/10 text-success">
            <PartyPopper size={26} />
          </div>
          <p className="text-lg font-semibold text-gray-100">SUCCESS</p>
          <p className="text-sm text-gray-400">Coupon successfully used.</p>
          <div className="mt-4 w-full max-w-xs space-y-1.5 text-sm">
            <Row label="Sponsor" value={screen.sponsorName} />
            <Row label="Code" value={screen.code} mono />
            <Row label="Discount" value={`${screen.discountPercentage}% OFF`} />
            <Row label="Final Price" value={formatMoney(screen.finalPriceCents)} />
            <Row label="Date/Time" value={new Date(screen.usedAt).toLocaleString()} />
          </div>
          <button className="btn-primary mt-6 w-full max-w-xs" onClick={reset}>
            Scan Next Customer
          </button>
        </div>
      )}
    </div>
  );
}

function ResultCard({
  result,
  onConfirm,
  onBack,
  formatMoney,
}: {
  result: ValidationResult;
  onConfirm: () => void;
  onBack: () => void;
  formatMoney: (cents: number) => string;
}) {
  if (result.outcome === 'INVALID') {
    return (
      <StatusCard icon={XCircle} tone="danger" title="INVALID CODE" message="This code does not exist in the system." onBack={onBack} />
    );
  }
  if (result.outcome === 'USED') {
    return (
      <StatusCard
        icon={XCircle}
        tone="danger"
        title="CODE ALREADY USED"
        message={`This coupon was already used on ${new Date(result.usedAt).toLocaleString()}.`}
        onBack={onBack}
      />
    );
  }
  if (result.outcome === 'EXPIRED') {
    return <StatusCard icon={Clock} tone="warning" title="CODE EXPIRED" message="This coupon's validity period has ended." onBack={onBack} />;
  }
  if (result.outcome === 'REVOKED') {
    return (
      <StatusCard
        icon={Ban}
        tone="danger"
        title="CODE REVOKED"
        message={result.reason ? `This coupon was revoked: ${result.reason}` : 'This coupon has been revoked.'}
        onBack={onBack}
      />
    );
  }

  if (result.outcome === 'RESERVED') {
    // Validation-only: a reserved coupon is never consumable from this
    // screen. It becomes USED automatically when its reservation is paid.
    const r = result.reservation;
    return (
      <StatusCard
        icon={Lock}
        tone="warning"
        title="COUPON RESERVED"
        message={`This coupon is already reserved and cannot be used for another reservation. Held by reservation #${r.id} (${r.customerName}, ${r.reservationDate} ${r.startTime}).`}
        onBack={onBack}
      />
    );
  }

  const coupon = result.coupon;
  return (
    <div className="card p-6">
      <div className="mb-4 flex items-center gap-2 text-success">
        <CheckCircle2 size={20} />
        <h2 className="text-base font-semibold">VALID COUPON</h2>
      </div>
      <div className="space-y-2 text-sm">
        <Row label="Sponsor" value={coupon.sponsorName} />
        <Row label="Campaign" value={coupon.campaignName} />
        <Row label="Service" value={`${coupon.serviceName}${coupon.duration ? ` (${coupon.duration})` : ''}`} />
        <Row label="Original Price" value={formatMoney(coupon.originalPriceCents)} muted />
        <Row label="Discount" value={`${coupon.discountPercentage}%`} />
        <Row label="Final Price" value={formatMoney(coupon.finalPriceCents)} highlight />
        <Row label="Status" value="AVAILABLE" />
        {coupon.expiresAt && <Row label="Expiration" value={new Date(coupon.expiresAt).toLocaleDateString()} />}
      </div>
      <div className="mt-6 flex gap-2">
        <button className="btn-secondary flex-1" onClick={onBack}>
          Cancel
        </button>
        <button className="btn-primary flex-1" onClick={onConfirm}>
          Confirm Use
        </button>
      </div>
    </div>
  );
}

function StatusCard({
  icon: Icon,
  tone,
  title,
  message,
  onBack,
}: {
  icon: LucideIcon;
  tone: 'danger' | 'warning';
  title: string;
  message: string;
  onBack: () => void;
}) {
  const cls = tone === 'danger' ? 'bg-danger/10 text-danger' : 'bg-warning/10 text-warning';
  return (
    <div className="card flex flex-col items-center gap-3 p-10 text-center">
      <div className={`flex h-14 w-14 items-center justify-center rounded-full ${cls}`}>
        <Icon size={26} />
      </div>
      <p className="text-lg font-semibold text-gray-100">{title}</p>
      <p className="max-w-xs text-sm text-gray-400">{message}</p>
      <button className="btn-secondary mt-4 w-full max-w-xs" onClick={onBack}>
        Try Another Code
      </button>
    </div>
  );
}

function Row({ label, value, mono, muted, highlight }: { label: string; value: string; mono?: boolean; muted?: boolean; highlight?: boolean }) {
  return (
    <div className="flex justify-between border-b border-base-border/60 pb-2 last:border-0">
      <span className="text-gray-500">{label}</span>
      <span
        className={[
          mono ? 'font-mono' : '',
          muted ? 'text-gray-500 line-through' : highlight ? 'font-semibold text-accent' : 'text-gray-200',
        ].join(' ')}
      >
        {value}
      </span>
    </div>
  );
}
