import { ReactNode, useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { LoginLanguageSwitcher } from '../i18n/LoginLanguageSwitcher';

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = 'login' | 'register';
type RegisterStep = 1 | 2 | 3;

interface ApiError {
  message: string;
}

// ─── API helpers ──────────────────────────────────────────────────────────────

const BASE = '';

async function apiPost<T>(path: string, body: Record<string, string>): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok || json.ok === false) {
    throw new Error(json.message || json.error || 'Request failed');
  }
  return json as T;
}

// ─── Spinner ──────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 14,
        height: 14,
        border: '2px solid rgba(255,255,255,0.4)',
        borderTopColor: '#fff',
        borderRadius: '50%',
        animation: 'auth-spin 0.7s linear infinite',
        flexShrink: 0,
      }}
    />
  );
}

// ─── EyeIcon ──────────────────────────────────────────────────────────────────

function EyeIcon({ visible }: { visible: boolean }) {
  return visible ? (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

// ─── GitHubIcon / GoogleIcon ──────────────────────────────────────────────────

function GitHubIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0 0 22 12.017C22 6.484 17.522 2 12 2z" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

// ─── PasswordInput ────────────────────────────────────────────────────────────

interface PasswordInputProps {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  autoComplete?: string;
}

function PasswordInput({ id, value, onChange, placeholder, disabled, autoComplete }: PasswordInputProps) {
  const [show, setShow] = useState(false);

  return (
    <div style={{ position: 'relative' }}>
      <input
        id={id}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete={autoComplete}
        className="input"
        style={{ paddingRight: 40 }}
      />
      <button
        type="button"
        onClick={() => setShow(s => !s)}
        disabled={disabled}
        style={{
          position: 'absolute',
          right: 10,
          top: '50%',
          transform: 'translateY(-50%)',
          background: 'none',
          border: 'none',
          padding: 0,
          color: 'var(--color-text-muted)',
          cursor: disabled ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
        }}
        aria-label={show ? 'hide password' : 'show password'}
      >
        <EyeIcon visible={show} />
      </button>
    </div>
  );
}

// ─── OTP Input (6 boxes) ──────────────────────────────────────────────────────

interface OtpInputProps {
  value: string[];
  onChange: (v: string[]) => void;
  disabled?: boolean;
}

function OtpInput({ value, onChange, disabled }: OtpInputProps) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const handleChange = (idx: number, raw: string) => {
    const ch = raw.replace(/\D/g, '').slice(-1);
    const next = [...value];
    next[idx] = ch;
    onChange(next);
    if (ch && idx < 5) {
      refs.current[idx + 1]?.focus();
    }
  };

  const handleKeyDown = (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (value[idx]) {
        const next = [...value];
        next[idx] = '';
        onChange(next);
      } else if (idx > 0) {
        refs.current[idx - 1]?.focus();
      }
    } else if (e.key === 'ArrowLeft' && idx > 0) {
      refs.current[idx - 1]?.focus();
    } else if (e.key === 'ArrowRight' && idx < 5) {
      refs.current[idx + 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const digits = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    const next = Array(6).fill('');
    digits.split('').forEach((d, i) => { next[i] = d; });
    onChange(next);
    const focusIdx = Math.min(digits.length, 5);
    refs.current[focusIdx]?.focus();
  };

  return (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
      {Array.from({ length: 6 }, (_, i) => (
        <input
          key={i}
          ref={el => { refs.current[i] = el; }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={value[i] || ''}
          onChange={e => handleChange(i, e.target.value)}
          onKeyDown={e => handleKeyDown(i, e)}
          onPaste={handlePaste}
          disabled={disabled}
          style={{
            width: 44,
            height: 52,
            textAlign: 'center',
            fontSize: 20,
            fontWeight: 700,
            border: `2px solid ${value[i] ? 'var(--color-primary)' : 'var(--color-border)'}`,
            borderRadius: 'var(--radius-md)',
            outline: 'none',
            background: '#fff',
            color: 'var(--color-text)',
            transition: 'border-color 0.15s',
            fontFamily: 'var(--font-mono)',
          }}
          onFocus={e => { (e.target as HTMLInputElement).style.borderColor = 'var(--color-primary)'; }}
          onBlur={e => { (e.target as HTMLInputElement).style.borderColor = value[i] ? 'var(--color-primary)' : 'var(--color-border)'; }}
        />
      ))}
    </div>
  );
}

// ─── Main AuthGuard ───────────────────────────────────────────────────────────

export function AuthGuard({ children }: { children: ReactNode }) {
  const { t: t_auth } = useTranslation('auth');
  const [token, setToken] = useState(() => localStorage.getItem('grc_admin_token'));

  // ── Tab state ──
  const [tab, setTab] = useState<Tab>('login');

  // ── Login state ──
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState('');

  // ── Register state ──
  const [step, setStep] = useState<RegisterStep>(1);
  const [regEmail, setRegEmail] = useState('');
  const [otpValue, setOtpValue] = useState<string[]>(Array(6).fill(''));
  const [regPassword, setRegPassword] = useState('');
  const [regConfirm, setRegConfirm] = useState('');
  const [regLoading, setRegLoading] = useState(false);
  const [regError, setRegError] = useState('');
  const [regSuccess, setRegSuccess] = useState('');

  // ── Cooldown timer ──
  const [cooldown, setCooldown] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startCooldown = useCallback(() => {
    setCooldown(60);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setCooldown(prev => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // ── Handlers ──

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    if (!loginEmail.trim() || !loginPassword) {
      setLoginError(t_auth('login.enterEmailPassword'));
      return;
    }
    setLoginLoading(true);
    try {
      const res = await apiPost<{ ok: boolean; token: string; refreshToken?: string }>(
        '/auth/email/login',
        { email: loginEmail.trim(), password: loginPassword },
      );
      localStorage.setItem('grc_admin_token', res.token);
      setToken(res.token);
    } catch (err: unknown) {
      setLoginError((err as ApiError).message || t_auth('login.loginFailed'));
    } finally {
      setLoginLoading(false);
    }
  };

  const handleSendCode = async () => {
    setRegError('');
    if (!regEmail.trim()) {
      setRegError(t_auth('register.step1.enterEmail'));
      return;
    }
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRe.test(regEmail.trim())) {
      setRegError(t_auth('register.step1.invalidEmail'));
      return;
    }
    setRegLoading(true);
    try {
      await apiPost<{ ok: boolean; message?: string }>(
        '/auth/email/send-code',
        { email: regEmail.trim() },
      );
      setRegSuccess(t_auth('register.step2.codeSentCheck'));
      startCooldown();
      setStep(2);
    } catch (err: unknown) {
      setRegError((err as ApiError).message || t_auth('register.step1.sendFailed'));
    } finally {
      setRegLoading(false);
    }
  };

  const handleResendCode = async () => {
    if (cooldown > 0) return;
    setRegError('');
    setRegSuccess('');
    setRegLoading(true);
    try {
      await apiPost<{ ok: boolean }>('/auth/email/send-code', { email: regEmail.trim() });
      setRegSuccess(t_auth('register.step2.codeResent'));
      startCooldown();
    } catch (err: unknown) {
      setRegError((err as ApiError).message || t_auth('register.step2.resendFailed'));
    } finally {
      setRegLoading(false);
    }
  };

  const handleVerifyCode = async () => {
    setRegError('');
    const code = otpValue.join('');
    if (code.length < 6) {
      setRegError(t_auth('register.step2.enterFullCode'));
      return;
    }
    setRegLoading(true);
    try {
      await apiPost<{ ok: boolean; verified: boolean }>(
        '/auth/email/verify-code',
        { email: regEmail.trim(), code },
      );
      setRegSuccess(t_auth('register.step3.emailVerified'));
      setStep(3);
    } catch (err: unknown) {
      setRegError((err as ApiError).message || t_auth('register.step2.invalidCode'));
    } finally {
      setRegLoading(false);
    }
  };

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegError('');
    if (regPassword.length < 8) {
      setRegError(t_auth('register.step3.minLengthError'));
      return;
    }
    if (regPassword !== regConfirm) {
      setRegError(t_auth('register.step3.mismatchError'));
      return;
    }
    setRegLoading(true);
    try {
      const res = await apiPost<{ ok: boolean; token: string; refreshToken?: string }>(
        '/auth/email/register',
        { email: regEmail.trim(), password: regPassword, verification_code: otpValue.join('') },
      );
      localStorage.setItem('grc_admin_token', res.token);
      setToken(res.token);
    } catch (err: unknown) {
      setRegError((err as ApiError).message || t_auth('register.step3.registerFailed'));
    } finally {
      setRegLoading(false);
    }
  };

  const switchTab = (t: Tab) => {
    setTab(t);
    setLoginError('');
    setRegError('');
    setRegSuccess('');
  };

  // ── Already authenticated ──
  if (token) {
    return <>{children}</>;
  }

  // ── Login page ──
  return (
    <>
      {/* Keyframe injection */}
      <style>{`
        @keyframes auth-spin {
          to { transform: rotate(360deg); }
        }
        @keyframes auth-fade-in {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
          padding: '24px 16px',
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: 420,
            background: '#fff',
            borderRadius: 16,
            boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
            overflow: 'hidden',
            animation: 'auth-fade-in 0.35s ease both',
          }}
        >
          {/* Header */}
          <div
            style={{
              background: 'linear-gradient(135deg, var(--color-primary) 0%, #2563eb 100%)',
              padding: '28px 32px 24px',
              textAlign: 'center',
              position: 'relative',
            }}
          >
            {/* Language switcher in top-right */}
            <div style={{ position: 'absolute', top: 12, right: 12 }}>
              <LoginLanguageSwitcher />
            </div>
            <div
              style={{
                width: 48,
                height: 48,
                background: 'rgba(255,255,255,0.2)',
                borderRadius: 12,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 14px',
                fontSize: 22,
                fontWeight: 800,
                color: '#fff',
                backdropFilter: 'blur(8px)',
                border: '1px solid rgba(255,255,255,0.25)',
              }}
            >
              G
            </div>
            <h1
              style={{
                color: '#fff',
                fontSize: 20,
                fontWeight: 700,
                margin: 0,
                letterSpacing: '-0.01em',
              }}
            >
              {t_auth('login.title')}
            </h1>
            <p
              style={{
                color: 'rgba(255,255,255,0.75)',
                fontSize: 13,
                margin: '6px 0 0',
              }}
            >
              {t_auth('login.subtitle')}
            </p>
          </div>

          {/* Tabs */}
          <div
            style={{
              display: 'flex',
              borderBottom: '1px solid var(--color-border)',
              background: 'var(--color-border-light)',
            }}
          >
            {(['login', 'register'] as const).map(t => (
              <button
                key={t}
                type="button"
                onClick={() => switchTab(t)}
                style={{
                  flex: 1,
                  padding: '12px 0',
                  background: tab === t ? '#fff' : 'transparent',
                  border: 'none',
                  borderBottom: tab === t ? '2px solid var(--color-primary)' : '2px solid transparent',
                  color: tab === t ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                  fontWeight: tab === t ? 700 : 500,
                  fontSize: 14,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  letterSpacing: '0.01em',
                  textTransform: 'capitalize',
                }}
              >
                {t === 'login' ? t_auth('login.tabSignIn') : t_auth('login.tabCreateAccount')}
              </button>
            ))}
          </div>

          {/* Body */}
          <div style={{ padding: '28px 32px 32px' }}>

            {/* ── LOGIN TAB ── */}
            {tab === 'login' && (
              <form onSubmit={handleLogin} noValidate>
                {loginError && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 8,
                      background: 'var(--color-danger-bg)',
                      border: '1px solid rgba(255,0,110,0.2)',
                      borderRadius: 8,
                      padding: '10px 14px',
                      marginBottom: 16,
                      color: '#dc2626',
                      fontSize: 13,
                    }}
                  >
                    <span style={{ flexShrink: 0 }}>⚠</span>
                    <span>{loginError}</span>
                  </div>
                )}

                <div style={{ marginBottom: 16 }}>
                  <label className="label" htmlFor="login-email">{t_auth('login.emailLabel')}</label>
                  <input
                    id="login-email"
                    type="email"
                    value={loginEmail}
                    onChange={e => setLoginEmail(e.target.value)}
                    placeholder={t_auth('login.emailPlaceholder')}
                    disabled={loginLoading}
                    autoComplete="email"
                    className="input"
                  />
                </div>

                <div style={{ marginBottom: 20 }}>
                  <label className="label" htmlFor="login-password">{t_auth('login.passwordLabel')}</label>
                  <PasswordInput
                    id="login-password"
                    value={loginPassword}
                    onChange={setLoginPassword}
                    placeholder={t_auth('login.passwordPlaceholder')}
                    disabled={loginLoading}
                    autoComplete="current-password"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loginLoading}
                  className="btn btn-primary"
                  style={{ width: '100%', height: 42, fontSize: 14, gap: 8 }}
                >
                  {loginLoading && <Spinner />}
                  {loginLoading ? t_auth('login.signingIn') : t_auth('login.signInButton')}
                </button>

                <OAuthDivider />

                <OAuthButtons />
              </form>
            )}

            {/* ── REGISTER TAB ── */}
            {tab === 'register' && (
              <div>
                {/* Step indicator */}
                <StepIndicator current={step} />

                {regError && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 8,
                      background: 'var(--color-danger-bg)',
                      border: '1px solid rgba(255,0,110,0.2)',
                      borderRadius: 8,
                      padding: '10px 14px',
                      marginBottom: 16,
                      color: '#dc2626',
                      fontSize: 13,
                    }}
                  >
                    <span style={{ flexShrink: 0 }}>⚠</span>
                    <span>{regError}</span>
                  </div>
                )}

                {regSuccess && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 8,
                      background: 'var(--color-success-bg)',
                      border: '1px solid rgba(6,214,160,0.3)',
                      borderRadius: 8,
                      padding: '10px 14px',
                      marginBottom: 16,
                      color: '#059669',
                      fontSize: 13,
                    }}
                  >
                    <span style={{ flexShrink: 0 }}>✓</span>
                    <span>{regSuccess}</span>
                  </div>
                )}

                {/* STEP 1: Email */}
                {step === 1 && (
                  <div>
                    <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 20 }}>
                      {t_auth('register.step1.description')}
                    </p>
                    <div style={{ marginBottom: 20 }}>
                      <label className="label" htmlFor="reg-email">{t_auth('register.step1.emailLabel')}</label>
                      <input
                        id="reg-email"
                        type="email"
                        value={regEmail}
                        onChange={e => setRegEmail(e.target.value)}
                        placeholder={t_auth('login.emailPlaceholder')}
                        disabled={regLoading}
                        autoComplete="email"
                        className="input"
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleSendCode(); } }}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleSendCode}
                      disabled={regLoading}
                      className="btn btn-primary"
                      style={{ width: '100%', height: 42, fontSize: 14, gap: 8 }}
                    >
                      {regLoading && <Spinner />}
                      {regLoading ? t_auth('register.step1.sending') : t_auth('register.step1.sendCode')}
                    </button>

                    <OAuthDivider />
                    <OAuthButtons />
                  </div>
                )}

                {/* STEP 2: OTP */}
                {step === 2 && (
                  <div>
                    <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 4 }}>
                      {t_auth('register.step2.codeSent')}
                    </p>
                    <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', marginBottom: 20 }}>
                      {regEmail}
                    </p>

                    <div style={{ marginBottom: 24 }}>
                      <label className="label" style={{ textAlign: 'center', display: 'block', marginBottom: 12 }}>
                        {t_auth('register.step2.codePlaceholder')}
                      </label>
                      <OtpInput value={otpValue} onChange={setOtpValue} disabled={regLoading} />
                    </div>

                    <button
                      type="button"
                      onClick={handleVerifyCode}
                      disabled={regLoading || otpValue.join('').length < 6}
                      className="btn btn-primary"
                      style={{ width: '100%', height: 42, fontSize: 14, gap: 8, marginBottom: 16 }}
                    >
                      {regLoading && <Spinner />}
                      {regLoading ? t_auth('register.step2.verifying') : t_auth('register.step2.verifyButton')}
                    </button>

                    <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--color-text-secondary)' }}>
                      {t_auth('register.step2.didntReceive')}{' '}
                      {cooldown > 0 ? (
                        <span style={{ color: 'var(--color-text-muted)' }}>
                          {t_auth('register.step2.resendIn', { cooldown })}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={handleResendCode}
                          disabled={regLoading}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: 'var(--color-primary)',
                            fontWeight: 600,
                            cursor: 'pointer',
                            fontSize: 13,
                            padding: 0,
                          }}
                        >
                          {t_auth('register.step2.resendCode')}
                        </button>
                      )}
                    </div>

                    <div style={{ textAlign: 'center', marginTop: 12 }}>
                      <button
                        type="button"
                        onClick={() => { setStep(1); setOtpValue(Array(6).fill('')); setRegError(''); setRegSuccess(''); }}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--color-text-muted)',
                          fontSize: 12,
                          cursor: 'pointer',
                          padding: 0,
                        }}
                      >
                        {t_auth('register.step2.changeEmail')}
                      </button>
                    </div>
                  </div>
                )}

                {/* STEP 3: Password */}
                {step === 3 && (
                  <form onSubmit={handleCreateAccount} noValidate>
                    <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 20 }}>
                      {t_auth('register.step3.setPassword')} <strong style={{ color: 'var(--color-text)' }}>{regEmail}</strong>
                    </p>

                    <div style={{ marginBottom: 16 }}>
                      <label className="label" htmlFor="reg-password">
                        {t_auth('register.step3.passwordLabel')} <span style={{ color: 'var(--color-text-muted)', fontWeight: 400, textTransform: 'none' }}>{t_auth('register.step3.passwordHint')}</span>
                      </label>
                      <PasswordInput
                        id="reg-password"
                        value={regPassword}
                        onChange={setRegPassword}
                        placeholder={t_auth('register.step3.passwordPlaceholder')}
                        disabled={regLoading}
                        autoComplete="new-password"
                      />
                      {regPassword.length > 0 && regPassword.length < 8 && (
                        <p style={{ fontSize: 11, color: '#dc2626', marginTop: 4 }}>
                          {t_auth('register.step3.minLength')}
                        </p>
                      )}
                    </div>

                    <div style={{ marginBottom: 24 }}>
                      <label className="label" htmlFor="reg-confirm">{t_auth('register.step3.confirmLabel')}</label>
                      <PasswordInput
                        id="reg-confirm"
                        value={regConfirm}
                        onChange={setRegConfirm}
                        placeholder={t_auth('register.step3.confirmPlaceholder')}
                        disabled={regLoading}
                        autoComplete="new-password"
                      />
                      {regConfirm.length > 0 && regConfirm !== regPassword && (
                        <p style={{ fontSize: 11, color: '#dc2626', marginTop: 4 }}>
                          {t_auth('register.step3.mismatch')}
                        </p>
                      )}
                      {regConfirm.length > 0 && regConfirm === regPassword && regPassword.length >= 8 && (
                        <p style={{ fontSize: 11, color: '#059669', marginTop: 4 }}>
                          {t_auth('register.step3.match')}
                        </p>
                      )}
                    </div>

                    <button
                      type="submit"
                      disabled={regLoading || regPassword.length < 8 || regPassword !== regConfirm}
                      className="btn btn-primary"
                      style={{ width: '100%', height: 42, fontSize: 14, gap: 8 }}
                    >
                      {regLoading && <Spinner />}
                      {regLoading ? t_auth('register.step3.creating') : t_auth('register.step3.createButton')}
                    </button>
                  </form>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: RegisterStep }) {
  const { t } = useTranslation('auth');
  const steps = [
    { n: 1, label: t('register.steps.email') },
    { n: 2, label: t('register.steps.verify') },
    { n: 3, label: t('register.steps.password') },
  ];

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        marginBottom: 24,
        position: 'relative',
      }}
    >
      {steps.map((s, i) => {
        const done = (current as number) > s.n;
        const active = current === s.n;
        return (
          <div key={s.n} style={{ display: 'flex', alignItems: 'center', flex: i < 2 ? 1 : 'none' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  background: done
                    ? '#059669'
                    : active
                      ? 'var(--color-primary)'
                      : 'var(--color-border)',
                  color: done || active ? '#fff' : 'var(--color-text-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  fontWeight: 700,
                  transition: 'background 0.2s',
                  flexShrink: 0,
                }}
              >
                {done ? '✓' : s.n}
              </div>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: active ? 700 : 500,
                  color: active ? 'var(--color-primary)' : done ? '#059669' : 'var(--color-text-muted)',
                  whiteSpace: 'nowrap',
                }}
              >
                {s.label}
              </span>
            </div>
            {i < 2 && (
              <div
                style={{
                  flex: 1,
                  height: 2,
                  background: done ? '#059669' : 'var(--color-border)',
                  margin: '0 6px',
                  marginBottom: 18,
                  transition: 'background 0.2s',
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function OAuthDivider() {
  const { t } = useTranslation('auth');
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        margin: '20px 0',
        color: 'var(--color-text-muted)',
        fontSize: 12,
      }}
    >
      <div style={{ flex: 1, height: 1, background: 'var(--color-border)' }} />
      <span style={{ whiteSpace: 'nowrap', fontWeight: 500 }}>{t('login.orContinueWith')}</span>
      <div style={{ flex: 1, height: 1, background: 'var(--color-border)' }} />
    </div>
  );
}

function OAuthButtons() {
  const { t } = useTranslation('auth');
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      <a
        href="/auth/github"
        className="btn btn-default"
        style={{
          flex: 1,
          height: 42,
          fontSize: 13,
          gap: 8,
          justifyContent: 'center',
          textDecoration: 'none',
        }}
      >
        <GitHubIcon />
        {t('login.github')}
      </a>
      <a
        href="/auth/google"
        className="btn btn-default"
        style={{
          flex: 1,
          height: 42,
          fontSize: 13,
          gap: 8,
          justifyContent: 'center',
          textDecoration: 'none',
        }}
      >
        <GoogleIcon />
        {t('login.google')}
      </a>
    </div>
  );
}
