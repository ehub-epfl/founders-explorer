import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  signInWithEmailOtp,
  signInWithGoogle,
  verifyEmailOtp,
  signInWithPassword,
  signUpWithPassword,
  resendConfirmationEmail,
  requestPasswordReset,
  updatePassword,
} from '../api/auth';
import { useAuth } from '../context/AuthContext';
import './Auth.css';

const OTP_RESEND_SECONDS = 60;
const SIGNUP_RESEND_SECONDS = 60;

function parseRateLimitedSeconds(message) {
  if (!message) return null;
  const match = message.match(/(?:after|in)\s+(\d+)\s+seconds?/i);
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) ? seconds : null;
}


export default function AuthPage() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from || '/compass';
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
  const [otpCooldown, setOtpCooldown] = useState(0); // seconds until user can resend OTP
  const [signupEmailSent, setSignupEmailSent] = useState(false);
  const [signupResendCooldown, setSignupResendCooldown] = useState(0);
  const [resendingConfirmation, setResendingConfirmation] = useState(false);

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
    setOtpCooldown(0);
    setSignupEmailSent(false);
    setSignupResendCooldown(0);
    setResendingConfirmation(false);
  }, [mode]);

  useEffect(() => {
    // Reset transient state when switching between stacks
    setMessage('');
    setOtp('');
    setStep('enterEmail');
    setNewPassword('');
    setNewPasswordConfirm('');
    setSubmitting(false);
    setOtpCooldown(0);
  }, [authStack]);

  useEffect(() => {
    if (signupResendCooldown <= 0) return;

    const timerId = setInterval(() => {
      setSignupResendCooldown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);

    return () => clearInterval(timerId);
  }, [signupResendCooldown]);

  useEffect(() => {
    if (otpCooldown <= 0) return;

    const timerId = setInterval(() => {
      setOtpCooldown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);

    return () => clearInterval(timerId);
  }, [otpCooldown]);


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
      const throttleSeconds = parseRateLimitedSeconds(error.message);
      if (throttleSeconds) {
        setOtpCooldown(throttleSeconds);
        // Keep a generic message without seconds
        setMessage('Too many attempts. Please wait before trying again.');
      } else {
        setMessage(error.message);
      }
      return;
    }
    setOtpCooldown(OTP_RESEND_SECONDS); // cooldown before resending
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
    setOtpRateLimitActive(false);
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
        setSignupEmailSent(false);
        setSignupResendCooldown(0);
        return;
      }
      if (!data?.session) {
        setMessage('Sign up successful. Please check your email to confirm your account.');
        setSignupEmailSent(true);
        setSignupResendCooldown(SIGNUP_RESEND_SECONDS);
      } else {
        setMessage('Signed up successfully. Redirecting...');
        setSignupEmailSent(false);
        setSignupResendCooldown(0);
      }
    } else {
      const { error } = await signInWithPassword(email, password);
      setSubmitting(false);
      if (error) {
        setMessage(error.message);
        setSignupEmailSent(false);
        setSignupResendCooldown(0);
        return;
      }
      setMessage('Signed in successfully. Redirecting...');
      setSignupEmailSent(false);
      setSignupResendCooldown(0);
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

  async function handleResendConfirmation() {
    if (!email || signupResendCooldown > 0) return;
    setResendingConfirmation(true);
    setMessage('');
    const { error } = await resendConfirmationEmail(email);
    setResendingConfirmation(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    setSignupResendCooldown(SIGNUP_RESEND_SECONDS);
    setMessage('Confirmation email resent. Please check your inbox.');
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
    <div className="auth-page">
      <div className="auth-frame">
        <h1 className="auth-title">{mode === 'login' ? 'Sign In' : 'Create Account'}</h1>

        <button className="auth-google-button" type="button" onClick={handleGoogle} disabled={submitting}>
          Continue with Google
        </button>

        <div className="auth-or">OR</div>

        <div className="auth-panel">
          {mode === 'login' && authStack === 'password' && (
            <>
              <input
                id="login-email"
                className="auth-input"
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
              />
              <input
                id="login-password"
                className="auth-input"
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
              />
              <button
                type="button"
                className="auth-link auth-link-center"
                onClick={() => {
                  setStep('enterEmail');
                  setAuthStack('otp');
                }}
                disabled={submitting}
              >
                sign in with email code
              </button>
              <div className="auth-link-row">
                <button
                  type="button"
                  className="auth-link"
                  onClick={() => {
                    setStep('enterEmail');
                    setAuthStack('reset');
                  }}
                  disabled={submitting}
                >
                  forget password?
                </button>
                <button
                  type="button"
                  className="auth-link"
                  onClick={() => setMode('signup')}
                  disabled={submitting}
                >
                  create a new account?
                </button>
              </div>
              <button
                type="button"
                className="auth-next"
                onClick={handlePasswordAuth}
                disabled={submitting || !email || !password}
              >
                Next
              </button>
            </>
          )}

          {mode === 'login' && authStack === 'otp' && (
            <>
              <input
                id="otp-email"
                className="auth-input"
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
              />
              {step === 'enterOtp' && (
                <input
                  id="otp-code"
                  className="auth-input"
                  type="text"
                  placeholder="Verification code"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  disabled={submitting}
                />
              )}
              <div className="auth-actions">
                {step === 'enterEmail' ? (
                  <button
                    type="button"
                    className="auth-next"
                    onClick={handleSendOtp}
                    disabled={submitting || !email || otpCooldown > 0}
                  >
                    {otpCooldown > 0 ? `Send again in ${otpCooldown}s` : 'Send code'}
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="auth-next"
                      onClick={handleVerifyOtp}
                      disabled={submitting || !otp}
                    >
                      Verify
                    </button>
                    <button
                      type="button"
                      className="auth-secondary"
                      onClick={handleSendOtp}
                      disabled={submitting || !email || otpCooldown > 0}
                    >
                      {otpCooldown > 0 ? `Resend in ${otpCooldown}s` : 'Resend code'}
                    </button>
                  </>
                )}
              </div>
              <button
                type="button"
                className="auth-link"
                onClick={() => setAuthStack('password')}
                disabled={submitting}
              >
                back to password
              </button>
            </>
          )}

          {mode === 'login' && authStack === 'reset' && (
            <>
              <input
                id="reset-email"
                className="auth-input"
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
              />
              <button
                type="button"
                className="auth-next"
                onClick={handleResetPassword}
                disabled={submitting || !email}
              >
                Send reset link
              </button>
              <button
                type="button"
                className="auth-link"
                onClick={() => setAuthStack('password')}
                disabled={submitting}
              >
                back to sign in
              </button>
            </>
          )}

          {mode === 'login' && authStack === 'resetConfirm' && (
            <>
              <input
                id="reset-new-password"
                className="auth-input"
                type="password"
                placeholder="New password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={submitting}
              />
              <input
                id="reset-confirm-password"
                className="auth-input"
                type="password"
                placeholder="Confirm password"
                value={newPasswordConfirm}
                onChange={(e) => setNewPasswordConfirm(e.target.value)}
                disabled={submitting}
              />
              <button
                type="button"
                className="auth-next"
                onClick={handleUpdatePassword}
                disabled={submitting || !newPassword || !newPasswordConfirm}
              >
                Update password
              </button>
              <button
                type="button"
                className="auth-link"
                onClick={() => setAuthStack('password')}
                disabled={submitting}
              >
                back to sign in
              </button>
            </>
          )}

          {mode === 'signup' && (
            <>
              <input
                id="signup-email"
                className="auth-input"
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
              />
              <input
                id="signup-password"
                className="auth-input"
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
              />
              <input
                id="signup-confirm"
                className="auth-input"
                type="password"
                placeholder="Confirm password"
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                disabled={submitting}
              />
              <div className="auth-link-row">
                <button type="button" className="auth-link" onClick={() => setMode('login')} disabled={submitting}>
                  already have an account?
                </button>
              </div>
              <button
                type="button"
                className="auth-next"
                onClick={handlePasswordAuth}
                disabled={submitting || !email || !password || !passwordConfirm}
              >
                Sign up
              </button>
              {signupEmailSent && (
                <div className="auth-resend-wrapper">
                  <div className="auth-resend-counter">
                    {signupResendCooldown > 0
                      ? `You can resend the confirmation email in ${signupResendCooldown}s.`
                      : 'Didn’t receive the confirmation email?'}
                  </div>
                  <button
                    type="button"
                    className="auth-secondary"
                    onClick={handleResendConfirmation}
                    disabled={resendingConfirmation || signupResendCooldown > 0 || !email}
                  >
                    {resendingConfirmation ? 'Sending…' : 'Resend confirmation email'}
                  </button>
                </div>
              )}
            </>
          )}

          {message && <div className="auth-message">{message}</div>}
        </div>
      </div>
    </div>
  );
}
