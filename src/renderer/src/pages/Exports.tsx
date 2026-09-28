import { Download, FileText, Printer, QrCode } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useToast } from '@/components/ui/Toast';

export default function Exports() {
  const toast = useToast();

  const exportAllCoupons = async () => {
    try {
      const result = await window.api.importExport.exportCouponsCsv({});
      toast.show('success', `Exported ${result.count} codes to ${result.filePath}`);
    } catch (err) {
      toast.show('error', err instanceof Error ? err.message : 'Export failed');
    }
  };

  const exportAllHistory = async () => {
    try {
      const result = await window.api.history.exportCsv({});
      toast.show('success', `Exported ${result.count} records to ${result.filePath}`);
    } catch (err) {
      toast.show('error', err instanceof Error ? err.message : 'Export failed');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Exports</h1>
        <p className="text-sm text-gray-500">Export your data as CSV, or print QR coupon sheets as PDF</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="card p-5">
          <div className="icon-tile mb-3 bg-accent/15 text-accent">
            <QrCode size={20} />
          </div>
          <h2 className="text-sm font-semibold text-gray-100">All QR Codes (CSV)</h2>
          <p className="mt-1 text-xs text-gray-500">Export every coupon code with sponsor, campaign, price and status.</p>
          <button className="btn-primary mt-4 w-full" onClick={exportAllCoupons}>
            <Download size={15} /> Export CSV
          </button>
        </div>

        <div className="card p-5">
          <div className="icon-tile mb-3 bg-teal/15 text-teal">
            <FileText size={20} />
          </div>
          <h2 className="text-sm font-semibold text-gray-100">Usage History (CSV)</h2>
          <p className="mt-1 text-xs text-gray-500">Export every redeemed coupon with date, sponsor and final price.</p>
          <button className="btn-primary mt-4 w-full" onClick={exportAllHistory}>
            <Download size={15} /> Export CSV
          </button>
        </div>

        <div className="card p-5">
          <div className="icon-tile mb-3 bg-purple/15 text-purple">
            <Printer size={20} />
          </div>
          <h2 className="text-sm font-semibold text-gray-100">Printable QR Sheets (PDF)</h2>
          <p className="mt-1 text-xs text-gray-500">
            Select specific codes to print from the QR Codes page — each sheet includes the QR, code, discount and price.
          </p>
          <Link to="/coupons" className="btn-secondary mt-4 w-full">
            Go to QR Codes
          </Link>
        </div>
      </div>
    </div>
  );
}
