import successUrl from '@/assets/sounds/success.wav';
import notificationUrl from '@/assets/sounds/notification.wav';
import warningUrl from '@/assets/sounds/warning.wav';
import errorUrl from '@/assets/sounds/error.wav';

export type SoundKind = 'success' | 'notification' | 'warning' | 'error';

const SOURCES: Record<SoundKind, string> = {
  success: successUrl,
  notification: notificationUrl,
  warning: warningUrl,
  error: errorUrl,
};

// Preload once; reused across plays so there's no load delay on first use.
const cache = new Map<SoundKind, HTMLAudioElement>();

let enabled = true;
let volume = 0.6;

export function configureSounds(opts: { enabled: boolean; volume: number }): void {
  enabled = opts.enabled;
  volume = Math.min(1, Math.max(0, opts.volume));
}

export function playSound(kind: SoundKind): void {
  if (!enabled) return;
  let audio = cache.get(kind);
  if (!audio) {
    audio = new Audio(SOURCES[kind]);
    cache.set(kind, audio);
  }
  audio.volume = volume;
  audio.currentTime = 0;
  // Playback can be rejected by the browser autoplay policy before the
  // first user gesture; that's fine, it's just a notification sound.
  audio.play().catch(() => {});
}
