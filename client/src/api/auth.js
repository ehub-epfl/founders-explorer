import { supabase } from './supabaseClient';

export function signInWithEmailOtp(email) {
  return supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: `${window.location.origin}/auth/callback`,
    },
  });
}

export function verifyEmailOtp(email, token) {
  return supabase.auth.verifyOtp({
    type: 'email',
    email,
    token,
  });
}

export function signInWithGoogle() {
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}/auth/callback`,
    },
  });
}

export function signInWithPassword(email, password) {
  return supabase.auth.signInWithPassword({ email, password });
}

export function signUpWithPassword(email, password) {
  return supabase.auth.signUp({ email, password });
}

export async function signOut() {
  try {
    return await supabase.auth.signOut({ scope: 'global' });
  } catch (err) {
    const code = err?.code || err?.error || '';
    // If Supabase already dropped the session (session_not_found), clear local state so UI can still log out.
    if (code === 'session_not_found' || /session_not_found/i.test(String(err?.message || ''))) {
      console.warn('Supabase session not found on logout; clearing local session only.');
      return supabase.auth.signOut({ scope: 'local' });
    }
    throw err;
  }
}

export function requestPasswordReset(email) {
  return supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/auth/callback`,
  });
}

export function updatePassword(newPassword) {
  return supabase.auth.updateUser({ password: newPassword });
}

export function getSession() {
  return supabase.auth.getSession();
}

export function onAuthChange(callback) {
  return supabase.auth.onAuthStateChange((event, session) => callback({ event, session }));
}
