import { Loader2 } from 'lucide-react';

export function Spinner({ size = 18, label }: { size?: number; label?: string }) {
  return (
    <div className="flex items-center gap-2 text-gray-400 text-sm">
      <Loader2 size={size} className="animate-spin" />
      {label && <span>{label}</span>}
    </div>
  );
}

export function PageSpinner() {
  return (
    <div className="flex h-64 items-center justify-center">
      <Spinner size={24} label="Loading…" />
    </div>
  );
}
