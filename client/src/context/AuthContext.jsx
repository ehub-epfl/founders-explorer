import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { getSession, onAuthChange, signOut } from '../api/auth';
import { ensureProfileForUser } from '../api/profile';

const AuthContext = createContext({
  session: null,
  user: null,
  loading: true,
  isGuest: false,
  enterGuestMode: () => {},
});

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isGuest, setIsGuest] = useState(false);

  useEffect(() => {
    let mounted = true;

    getSession().then(({ data, error }) => {
      if (!mounted) return;
      if (error) {
        console.warn('Failed to get session', error);
      }
      setSession(data?.session ?? null);
      setIsGuest(false);
      setLoading(false);
    });

    const { data: listener } = onAuthChange(({ session: nextSession }) => {
      setSession(nextSession ?? null);
      setIsGuest(false);
    });

    return () => {
      mounted = false;
      listener?.subscription?.unsubscribe();
    };
  }, []);

  const enterGuestMode = () => {
    setIsGuest(true);
  };

  const value = useMemo(() => ({
    session,
    user: session?.user ?? null,
    loading,
    isGuest,
    enterGuestMode,
    signOut,
  }), [session, loading, isGuest]);

  useEffect(() => {
    let cancelled = false;
    async function syncProfile() {
      if (!session?.user) return;
      try {
        await ensureProfileForUser(session.user);
      } catch (err) {
        if (!cancelled) {
          console.warn('Failed to ensure profile for user', err);
        }
      }
    }
    syncProfile();
    return () => {
      cancelled = true;
    };
  }, [session]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
