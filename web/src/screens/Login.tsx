import { useEffect, useState } from 'react';
import { Field } from '../components/ui';
import { ApiError, api, findServer, type ServerStatus } from '../lib/api';
import { isNative } from '../lib/reminders';
import { getSnapshot, signIn } from '../lib/store';

export function Login() {
  // In the browser the server is wherever this page came from; the phone app has to be told.
  const [serverInput, setServerInput] = useState(getSnapshot().serverUrl);
  const [server, setServer] = useState<{ url: string; status: ServerStatus } | null>(null);
  const [username, setUsername] = useState(getSnapshot().username);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const connect = async (input: string) => {
    setBusy(true);
    setError('');
    try {
      setServer(isNative ? await findServer(input) : { url: '', status: await api.status('') });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!isNative) void connect('');
    else if (serverInput) void connect(serverInput);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const creating = server?.status.setupRequired ?? false;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!server) return void connect(serverInput);
    if (creating && password !== confirm) return setError('The two passwords don’t match.');
    if (creating && password.length < 8) return setError('Choose a password with at least 8 characters.');
    setBusy(true);
    setError('');
    try {
      const session = creating ? await api.setup(server.url, username.trim(), password) : await api.login(server.url, username.trim(), password);
      await signIn(server.url, session);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in');
      setBusy(false);
    }
  };

  return (
    <main className="login">
      <form className="login-card form" onSubmit={submit}>
        <img src="./icon.svg" alt="" width={64} height={64} className="login-logo" />
        <h1>Rxmindly</h1>

        {isNative && !server && (
          <>
            <p className="muted">Enter the address of your Rxmindly server.</p>
            <Field label="Server address" hint="For example 192.168.1.20:8080 or meds.example.com">
              <input className="input" value={serverInput} onChange={(e) => setServerInput(e.target.value)} inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="192.168.1.20:8080" required />
            </Field>
          </>
        )}

        {server && (
          <>
            <p className="muted">{creating ? 'Welcome. Create the account that will hold your medicines.' : 'Sign in to see your medicines.'}</p>
            {isNative && (
              <p className="server-line">
                <span className="muted">{server.url}</span>
                <button type="button" className="link" onClick={() => setServer(null)}>
                  Change
                </button>
              </p>
            )}
            <Field label="Username">
              <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} required />
            </Field>
            <Field label="Password" hint={creating ? 'At least 8 characters.' : undefined}>
              <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={creating ? 'new-password' : 'current-password'} required />
            </Field>
            {creating && (
              <Field label="Password again">
                <input className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
              </Field>
            )}
          </>
        )}

        {error && <p className="field-error" role="alert">{error}</p>}
        {(server || isNative) && (
          <button className="btn primary block" disabled={busy}>
            {busy ? 'One moment…' : !server ? 'Connect' : creating ? 'Create account' : 'Sign in'}
          </button>
        )}
        {!server && !isNative && !error && <p className="muted">Connecting…</p>}
        {!server && !isNative && error && (
          <button type="button" className="btn block" onClick={() => void connect('')}>
            Try again
          </button>
        )}
      </form>
    </main>
  );
}
