import { useEffect, useRef, useState, useCallback } from 'react';
import jsQR from 'jsqr';
import { CameraOff } from 'lucide-react';

export function ScannerCamera({ onDetect, active }: { onDetect: (code: string) => void; active: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastDetectionRef = useRef<{ code: string; at: number } | null>(null);
  const [cameraState, setCameraState] = useState<'requesting' | 'ready' | 'unavailable' | 'denied'>('requesting');

  const tick = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const result = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'dontInvert' });
        if (result && result.data) {
          const now = Date.now();
          const last = lastDetectionRef.current;
          // Debounce: ignore repeat detections of the same code within 2.5s
          // so a held-up QR doesn't fire confirmUse dozens of times.
          if (!last || last.code !== result.data || now - last.at > 2500) {
            lastDetectionRef.current = { code: result.data, at: now };
            onDetect(result.data);
          }
        }
      }
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [onDetect]);

  useEffect(() => {
    if (!active) return;

    let cancelled = false;
    setCameraState('requesting');

    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: 'environment' } })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }
        setCameraState('ready');
        rafRef.current = requestAnimationFrame(tick);
      })
      .catch((err) => {
        setCameraState(err?.name === 'NotAllowedError' ? 'denied' : 'unavailable');
      });

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [active, tick]);

  if (cameraState === 'unavailable' || cameraState === 'denied') {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-base-border bg-base-surface2/40 text-center">
        <CameraOff size={28} className="text-gray-600" />
        <p className="text-sm text-gray-400 px-6">
          {cameraState === 'denied' ? 'Camera access was denied.' : 'No camera detected.'} Enter the code manually below.
        </p>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-xl bg-black">
      <video ref={videoRef} className="h-64 w-full object-cover" muted playsInline />
      <canvas ref={canvasRef} className="hidden" />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-40 w-40 rounded-xl border-2 border-accent/80 shadow-[0_0_0_2000px_rgba(0,0,0,0.35)]" />
      </div>
      {cameraState === 'requesting' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-sm text-gray-300">
          Requesting camera access…
        </div>
      )}
    </div>
  );
}
