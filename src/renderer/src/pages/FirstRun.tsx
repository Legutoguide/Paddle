import { useState } from 'react';
import { QrCode } from 'lucide-react';

export default function FirstRun({ onComplete }: { onComplete: () => void }) {
  const [businessName, setBusinessName] = useState('');
  const [currency, setCurrency] = useState('TND');
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setError(null);

    if (!displayName.trim()) {
      setError('Your name is required');
      return;
    }
    if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username.trim())) {
      setError('Username must be 3-32 characters: letters, numbers, dot, dash or underscore');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setSaving(true);
    try {
      await window.api.settings.update({
        businessName: businessName.trim() || 'My Business',
        currency: currency.trim().toUpperCase() || 'TND',
      });
      await window.api.auth.createFirstUser({
        username: username.trim(),
        password,
        displayName: displayName.trim(),
      });
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto bg-base-bg py-8">
      <div className="card w-full max-w-md p-8">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-cyan text-white shadow-glow">
            <QrCode size={24} strokeWidth={2.5} />
          </div>
          <h1 className="text-lg font-semibold text-white">Welcome to Prime Paddle</h1>
          <p className="mt-1 text-sm text-gray-500">Let's set up your business and your CEO account.</p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="label">Business / Project Name</label>
            <input className="input" autoFocus value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="My Business" />
          </div>
          <div>
            <label className="label">Currency</label>
            <input className="input" value={currency} onChange={(e) => setCurrency(e.target.value)} maxLength={6} placeholder="TND" />
          </div>

          <div className="border-t border-base-border pt-4">
            <p className="mb-3 text-xs font-medium text-gray-400">
              You'll be the <span className="text-accent">CEO &amp; Founder</span> account — this only happens once.
            </p>
            <div className="space-y-4">
              <div>
                <label className="label">Your Name</label>
                <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="e.g. Adam Ben Ali" />
              </div>
              <div>
                <label className="label">Username</label>
                <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. adam" />
              </div>
              <div>
                <label className="label">Password</label>
                <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <div>
                <label className="label">Confirm Password</label>
                <input className="input" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
              </div>
            </div>
          </div>
        </div>

        {error && <p className="mt-4 text-sm text-danger">{error}</p>}

        <button className="btn-primary mt-6 w-full justify-center" onClick={submit} disabled={saving}>
          {saving ? 'Setting up…' : 'Create CEO Account & Get Started'}
        </button>

        <p className="mt-4 text-center text-xs text-gray-600">Everything runs locally on this computer. No internet connection required.</p>
      </div>
    </div>
  );
}
