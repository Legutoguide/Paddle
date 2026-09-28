import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { AppSettings } from '@shared/types/domain';
import { fromCents } from '@shared/lib/pricing';
import { configureSounds } from './soundService';

const FALLBACK: AppSettings = {
  businessName: 'My Business',
  currency: 'TND',
  logoPath: null,
  defaultExportFolder: null,
  theme: 'dark',
  autoBackupEnabled: true,
  autoBackupIntervalDays: 7,
  operatorMode: 'ADMIN',
  soundsEnabled: true,
  soundVolume: 0.6,
  country: '',
  timezone: 'UTC',
  dateFormat: 'DD/MM/YYYY',
  language: 'en',
  businessHours: '',
  phone: '',
  email: '',
  website: '',
  address: '',
  facebookUrl: '',
  instagramUrl: '',
  mainPhotoPath: null,
  coverBannerPath: null,
  dashboardBannerPath: null,
  primaryColor: '#2196f3',
  secondaryColor: '#14b8a6',
  footerContactInfo: '',
};

interface SettingsContextValue {
  settings: AppSettings;
  loading: boolean;
  refresh: () => Promise<void>;
  formatMoney: (cents: number) => string;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(FALLBACK);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const s = await window.api.settings.get();
    setSettings(s);
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  useEffect(() => {
    configureSounds({ enabled: settings.soundsEnabled, volume: settings.soundVolume });
  }, [settings.soundsEnabled, settings.soundVolume]);

  const formatMoney = useCallback(
    (cents: number) => `${fromCents(cents).toFixed(2)} ${settings.currency}`,
    [settings.currency]
  );

  return (
    <SettingsContext.Provider value={{ settings, loading, refresh, formatMoney }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}
