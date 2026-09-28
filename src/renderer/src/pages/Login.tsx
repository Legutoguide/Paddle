import { useState } from 'react';
import { QrCode, LogIn } from 'lucide-react';
import { useAuth } from '@/lib/authContext';
import { useSettings } from '@/lib/settingsContext';

export default function Login() {
  const { login } = useAuth();
  const { settings } = useSettings();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center bg-base-bg">
      <form onSubmit={submit} className="card w-full max-w-sm p-8">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-cyan text-white shadow-glow">
            <QrCode size={24} strokeWidth={2.3} />
          </div>
          <h1 className="text-lg font-semibold text-white">{settings.businessName}</h1>
          <p className="mt-1 text-sm text-gray-500">Sign in to Prime Paddle</p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="label">Username</label>
            <input
              className="input"
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
          </div>
          <div>
            <label className="label">Password</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
        </div>

        {error && <p className="mt-4 text-sm text-danger">{error}</p>}

        <button type="submit" className="btn-primary mt-6 w-full justify-center" disabled={busy}>
          <LogIn size={15} /> {busy ? 'Signing in…' : 'Sign In'}
        </button>

        <p className="mt-4 text-center text-xs text-gray-600">Works fully offline · No internet required</p>
      </form>
    </div>
  );
}
