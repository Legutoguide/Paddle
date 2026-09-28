import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import type { CouponWithDetails } from '@shared/types/domain';
import { Modal } from '@/components/ui/Modal';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useSettings } from '@/lib/settingsContext';
import { useToast } from '@/components/ui/Toast';

export function QrPreviewModal({ coupon, onClose }: { coupon: CouponWithDetails; onClose: () => void }) {
  const { formatMoney } = useSettings();
  const toast = useToast();
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    window.api.coupons.getQr(coupon.code).then(setDataUrl);
  }, [coupon.code]);

  const exportPng = async () => {
    try {
      const result = await window.api.importExport.exportCouponsPdf([coupon.id]);
      toast.show('success', `Saved to ${result.filePath}`);
    } catch (err) {
      toast.show('error', err instanceof Error ? err.message : 'Export failed');
    }
  };

  return (
    <Modal title="Coupon QR Code" onClose={onClose} width="max-w-sm">
      <div className="flex flex-col items-center text-center">
        <div className="rounded-xl bg-white p-4">
          {dataUrl ? <img src={dataUrl} alt={`QR code for ${coupon.code}`} className="h-48 w-48" /> : <div className="h-48 w-48" />}
        </div>
        <p className="mt-4 font-mono text-lg font-semibold text-gray-100">{coupon.code}</p>
        <div className="mt-1">
          <StatusBadge status={coupon.status} />
        </div>
        <div className="mt-4 w-full space-y-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500">Sponsor</span>
            <span className="text-gray-200">{coupon.sponsorName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Campaign</span>
            <span className="text-gray-200">{coupon.campaignName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Discount</span>
            <span className="text-accent">{coupon.discountPercentage}% OFF</span>
          </div>
          <div className="flex justify-between font-medium">
            <span className="text-gray-500">Final Price</span>
            <span className="text-gray-100">{formatMoney(coupon.finalPriceCents)}</span>
          </div>
          {coupon.expiresAt && (
            <div className="flex justify-between">
              <span className="text-gray-500">Valid until</span>
              <span className="text-gray-200">{new Date(coupon.expiresAt).toLocaleDateString()}</span>
            </div>
          )}
        </div>
        <button className="btn-secondary mt-5 w-full" onClick={exportPng}>
          <Download size={15} /> Export Printable PDF
        </button>
      </div>
    </Modal>
  );
}
