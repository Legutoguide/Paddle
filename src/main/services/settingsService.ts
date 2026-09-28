import type Database from 'better-sqlite3';
import type { AppSettings } from '../../shared/types/domain';
import { AuditService } from './auditService';

const DEFAULTS: AppSettings = {
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
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
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

export class SettingsService {
  private audit: AuditService;

  constructor(private db: Database.Database) {
    this.audit = new AuditService(db);
  }

  getAll(): AppSettings {
    const rows = this.db.prepare<[], { key: string; value: string }>(`SELECT key, value FROM settings`).all();
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const str = (key: keyof AppSettings) => map.get(key as string) ?? (DEFAULTS[key] as string);
    const nullableStr = (key: keyof AppSettings) => (map.has(key as string) ? map.get(key as string)! : (DEFAULTS[key] as string | null));

    return {
      businessName: str('businessName'),
      currency: str('currency'),
      logoPath: nullableStr('logoPath'),
      defaultExportFolder: nullableStr('defaultExportFolder'),
      theme: (map.get('theme') as AppSettings['theme']) ?? DEFAULTS.theme,
      autoBackupEnabled: map.has('autoBackupEnabled')
        ? map.get('autoBackupEnabled') === 'true'
        : DEFAULTS.autoBackupEnabled,
      autoBackupIntervalDays: map.has('autoBackupIntervalDays')
        ? Number(map.get('autoBackupIntervalDays'))
        : DEFAULTS.autoBackupIntervalDays,
      operatorMode: (map.get('operatorMode') as AppSettings['operatorMode']) ?? DEFAULTS.operatorMode,
      soundsEnabled: map.has('soundsEnabled') ? map.get('soundsEnabled') === 'true' : DEFAULTS.soundsEnabled,
      soundVolume: map.has('soundVolume') ? Number(map.get('soundVolume')) : DEFAULTS.soundVolume,
      country: str('country'),
      timezone: str('timezone'),
      dateFormat: str('dateFormat'),
      language: str('language'),
      businessHours: str('businessHours'),
      phone: str('phone'),
      email: str('email'),
      website: str('website'),
      address: str('address'),
      facebookUrl: str('facebookUrl'),
      instagramUrl: str('instagramUrl'),
      mainPhotoPath: nullableStr('mainPhotoPath'),
      coverBannerPath: nullableStr('coverBannerPath'),
      dashboardBannerPath: nullableStr('dashboardBannerPath'),
      primaryColor: str('primaryColor'),
      secondaryColor: str('secondaryColor'),
      footerContactInfo: str('footerContactInfo'),
    };
  }

  update(partial: Partial<AppSettings>): AppSettings {
    const upsert = this.db.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    );
    const del = this.db.prepare(`DELETE FROM settings WHERE key = ?`);
    const tx = this.db.transaction(() => {
      for (const [key, value] of Object.entries(partial)) {
        if (value === undefined) continue;
        if (value === null) {
          del.run(key);
          continue;
        }
        upsert.run(key, String(value));
      }
    });
    tx();
    this.audit.log('SETTINGS_UPDATED', 'settings', null, partial);
    return this.getAll();
  }

  isFirstRun(): boolean {
    const row = this.db
      .prepare<[], { c: number }>(`SELECT COUNT(*) as c FROM settings WHERE key = 'businessName'`)
      .get();
    return !row || row.c === 0;
  }
}
