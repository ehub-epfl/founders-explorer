import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  signInWithEmailOtp,
  signInWithGoogle,
  verifyEmailOtp,
  signInWithPassword,
  signUpWithPassword,
  requestPasswordReset,
  updatePassword,
} from '../api/auth';
import { useAuth } from '../context/AuthContext';

const containerStyle = {
  maxWidth: 420,
  margin: '0 auto',
  padding: '2rem 1rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '1rem',
};

const cardStyle = {
  border: '1px solid var(--color-border, #e5e7eb)',
  borderRadius: 12,
  padding: '1.25rem',
  background: 'var(--color-surface, #fff)',
  boxShadow: '0 8px 24px rgba(0,0,0,0.06)',
};

const inputStyle = {
  width: '100%',
  padding: '0.75rem',
  borderRadius: 8,
  border: '1px solid var(--color-border, #e5e7eb)',
  fontSize: '1rem',
};

const primaryButtonStyle = {
  width: '100%',
  padding: '0.75rem',
  borderRadius: 8,
  border: 'none',
  background: 'var(--color-primary, #111827)',
  color: '#fff',
  fontWeight: 600,
  cursor: 'pointer',
};

const secondaryButtonStyle = {
  width: '100%',
  padding: '0.75rem',
  borderRadius: 8,
  border: '1px solid var(--color-border, #e5e7eb)',
  background: '#fff',
  color: '#111827',
  fontWeight: 600,
  cursor: 'pointer',
};

export default function AuthPage() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from || '/courses';
  const authIntent = useMemo(() => {
    const searchParams = new URLSearchParams(location.search || '');
    const hashParams = new URLSearchParams((location.hash || '').replace(/^#/, ''));
    const type = (searchParams.get('type') || hashParams.get('type') || '').toLowerCase();
    return { type };
  }, [location.search, location.hash]);
  const isRecovery = authIntent.type === 'recovery';

  const [mode, setMode] = useState('login'); // login | signup (same flow)
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [step, setStep] = useState('enterEmail'); // enterEmail | enterOtp
  const [authStack, setAuthStack] = useState('password'); // password | otp | reset | resetConfirm
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const holdForReset = authStack === 'resetConfirm' || isRecovery;
    if (!loading && session && !holdForReset) {
      navigate(from, { replace: true });
    }
  }, [session, loading, navigate, from, authStack, isRecovery]);

  useEffect(() => {
    // Reset state when switching mode
    setMessage('');
    setPassword('');
    setPasswordConfirm('');
    setOtp('');
    setStep('enterEmail');
    setAuthStack(mode === 'login' ? 'password' : 'password');
  }, [mode]);

  useEffect(() => {
    // Reset transient state when switching between stacks
    setMessage('');
    setOtp('');
    setStep('enterEmail');
    setNewPassword('');
    setNewPasswordConfirm('');
    setSubmitting(false);
  }, [authStack]);

  useEffect(() => {
    if (isRecovery) {
      setMode('login');
      setAuthStack('resetConfirm');
    }
  }, [isRecovery]);

  async function handleSendOtp() {
    setSubmitting(true);
    setMessage('');
    const { error } = await signInWithEmailOtp(email);
    setSubmitting(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    setStep('enterOtp');
    setMessage('Verification code sent to your email.');
  }

  async function handleVerifyOtp() {
    setSubmitting(true);
    setMessage('');
    const { error } = await verifyEmailOtp(email, otp);
    setSubmitting(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    setMessage('Signed in successfully. Redirecting...');
  }

  async function handleGoogle() {
    setSubmitting(true);
    setMessage('');
    const { error } = await signInWithGoogle();
    setSubmitting(false);
    if (error) {
      setMessage(error.message);
    }
  }

  async function handlePasswordAuth() {
    setSubmitting(true);
    setMessage('');
    if (mode === 'signup') {
      if (password !== passwordConfirm) {
        setMessage('Passwords do not match.');
        setSubmitting(false);
        return;
      }
      const { error, data } = await signUpWithPassword(email, password);
      setSubmitting(false);
      if (error) {
        setMessage(error.message);
        return;
      }
      if (!data?.session) {
        setMessage('Sign up successful. Please check your email to confirm your account.');
      } else {
        setMessage('Signed up successfully. Redirecting...');
      }
    } else {
      const { error } = await signInWithPassword(email, password);
      setSubmitting(false);
      if (error) {
        setMessage(error.message);
        return;
      }
      setMessage('Signed in successfully. Redirecting...');
    }
  }

  async function handleResetPassword() {
    setSubmitting(true);
    setMessage('');
    const { error } = await requestPasswordReset(email);
    setSubmitting(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    setMessage('Password reset email sent. Check your inbox.');
  }

  async function handleUpdatePassword() {
    if (newPassword !== newPasswordConfirm) {
      setMessage('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    setMessage('');
    const { error } = await updatePassword(newPassword);
    setSubmitting(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    setMessage('Password updated. You can continue.');
    setAuthStack('password');
  }

  return (
    <div style={containerStyle}>
      <div style={{ textAlign: 'center' }}>
        <img src="/logo.svg" alt="logo" style={{ height: 40, marginBottom: 12 }} />
        <h1 style={{ margin: 0, fontSize: '1.5rem' }}>
          {mode === 'login' ? 'Log in' : 'Sign up'}
        </h1>
        <p style={{ color: 'var(--color-text-muted, #6b7280)', marginTop: 6 }}>
          Use your email to continue. You can choose password or email code.
        </p>
      </div>

      <div style={cardStyle}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button
            style={{ ...secondaryButtonStyle, background: mode === 'login' ? '#111827' : '#fff', color: mode === 'login' ? '#fff' : '#111827' }}
            onClick={() => setMode('login')}
          >
            Log in
          </button>
          <button
            style={{ ...secondaryButtonStyle, background: mode === 'signup' ? '#111827' : '#fff', color: mode === 'signup' ? '#fff' : '#111827' }}
            onClick={() => setMode('signup')}
          >
            Sign up
          </button>
        </div>

        <button style={secondaryButtonStyle} onClick={handleGoogle} disabled={submitting}>
          Continue with Google
        </button>

        <div style={{ height: 1, background: 'var(--color-border, #e5e7eb)', margin: '0.75rem 0' }} />

        {mode === 'login' && authStack === 'password' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: '0.75rem' }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Email and password</div>
            <label style={{ fontSize: 14, color: '#374151' }}>Email</label>
            <input
              style={{ ...inputStyle, marginBottom: '0.5rem' }}
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
            />
            <label style={{ fontSize: 14, color: '#374151' }}>Password</label>
            <input
              style={{ ...inputStyle, marginBottom: '0.5rem' }}
              type="password"
              placeholder="Enter password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button
                style={primaryButtonStyle}
                onClick={handlePasswordAuth}
                disabled={submitting || !email || !password}
              >
                Next
              </button>
              <button
                style={secondaryButtonStyle}
                onClick={() => {
                  setStep('enterEmail');
                  setAuthStack('otp');
                }}
                disabled={submitting}
              >
                Sign in with email code
              </button>
              <button
                style={{ ...secondaryButtonStyle, borderStyle: 'dashed' }}
                onClick={() => {
                  setStep('enterEmail');
                  setAuthStack('reset');
                }}
                disabled={submitting}
              >
                Forgot password
              </button>
            </div>
          </div>
        )}

        {mode === 'login' && authStack === 'otp' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: '0.75rem' }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Sign in with email code</div>
            <label style={{ fontSize: 14, color: '#374151' }}>Email</label>
            <input
              style={{ ...inputStyle, marginBottom: '0.5rem' }}
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
            />
            {step === 'enterEmail' && (
              <button style={primaryButtonStyle} onClick={handleSendOtp} disabled={submitting || !email}>
                Send code
              </button>
            )}
            {step === 'enterOtp' && (
              <>
                <label style={{ fontSize: 14, color: '#374151' }}>Verification code</label>
                <input
                  style={inputStyle}
                  type="text"
                  placeholder="6-digit code"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  disabled={submitting}
                />
                <button style={primaryButtonStyle} onClick={handleVerifyOtp} disabled={submitting || !otp}>
                  Verify and log in
                </button>
                <button style={secondaryButtonStyle} onClick={handleSendOtp} disabled={submitting || !email}>
                  Resend code
                </button>
              </>
            )}
            <button
              style={{ ...secondaryButtonStyle, borderStyle: 'dashed' }}
              onClick={() => setAuthStack('password')}
              disabled={submitting}
            >
              Back
            </button>
          </div>
        )}

        {mode === 'login' && authStack === 'reset' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: '0.75rem' }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Reset password</div>
            <label style={{ fontSize: 14, color: '#374151' }}>Email</label>
            <input
              style={{ ...inputStyle, marginBottom: '0.5rem' }}
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
            />
            <button style={primaryButtonStyle} onClick={handleResetPassword} disabled={submitting || !email}>
              Send reset link
            </button>
            <button
              style={{ ...secondaryButtonStyle, borderStyle: 'dashed' }}
              onClick={() => setAuthStack('password')}
              disabled={submitting}
            >
              Back
            </button>
          </div>
        )}

        {mode === 'login' && authStack === 'resetConfirm' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: '0.75rem' }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Set a new password</div>
            <label style={{ fontSize: 14, color: '#374151' }}>New password</label>
            <input
              style={{ ...inputStyle, marginBottom: '0.5rem' }}
              type="password"
              placeholder="Enter new password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              disabled={submitting}
            />
            <label style={{ fontSize: 14, color: '#374151' }}>Confirm password</label>
            <input
              style={{ ...inputStyle, marginBottom: '0.5rem' }}
              type="password"
              placeholder="Re-enter new password"
              value={newPasswordConfirm}
              onChange={(e) => setNewPasswordConfirm(e.target.value)}
              disabled={submitting}
            />
            <button
              style={primaryButtonStyle}
              onClick={handleUpdatePassword}
              disabled={submitting || !newPassword || !newPasswordConfirm}
            >
              Update password
            </button>
            <button
              style={{ ...secondaryButtonStyle, borderStyle: 'dashed' }}
              onClick={() => setAuthStack('password')}
              disabled={submitting}
            >
              Back
            </button>
          </div>
        )}

        {mode === 'signup' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: '0.75rem' }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Create account</div>
            <label style={{ fontSize: 14, color: '#374151' }}>Email</label>
            <input
              style={{ ...inputStyle, marginBottom: '0.5rem' }}
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
            />
            <label style={{ fontSize: 14, color: '#374151' }}>Password</label>
            <input
              style={{ ...inputStyle, marginBottom: '0.5rem' }}
              type="password"
              placeholder="Enter password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
            />
            <label style={{ fontSize: 14, color: '#374151' }}>Confirm password</label>
            <input
              style={{ ...inputStyle, marginBottom: '0.5rem' }}
              type="password"
              placeholder="Re-enter password"
              value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
              disabled={submitting}
            />
            <button
              style={primaryButtonStyle}
              onClick={handlePasswordAuth}
              disabled={submitting || !email || !password || (mode === 'signup' && !passwordConfirm)}
            >
              Sign up
            </button>
          </div>
        )}

        {message && (
          <div style={{ marginTop: 8, color: '#111827', fontSize: 14 }}>{message}</div>
        )}
      </div>
    </div>
  );
}
