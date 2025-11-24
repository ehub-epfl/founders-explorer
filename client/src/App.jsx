import { BrowserRouter as Router, Routes, Route, Link, Navigate } from "react-router-dom";
import GuidedSearch from './pages/GuidedSearch.jsx';
import CoursesList from "./pages/CoursesList.jsx";
import AuthPage from "./pages/Auth.jsx";
import ProtectedRoute from "./components/ProtectedRoute.jsx";
import { useAuth } from "./context/AuthContext.jsx";

function NavBar() {
  const { user, signOut } = useAuth();
  const email = user?.email || '';

  return (
    <nav
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '12px 0',
        marginBottom: '1.5rem',
        color: 'var(--color-text)',
        borderBottom: '1px solid var(--color-border-subtle)',
        justifyContent: 'space-between',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <img src="/logo.svg" alt="Site logo" style={{ height: '28px' }} />
        <Link to="/courses">Courses</Link>
        <span aria-hidden="true" style={{ color: 'var(--color-border)', fontSize: '0.9rem' }}>|</span>
        <Link to="/guided">Guided Search</Link>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {email && <span style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>{email}</span>}
        <button
          type="button"
          onClick={() => signOut()}
          style={{
            border: '1px solid var(--color-border)',
            background: 'var(--color-surface)',
            borderRadius: 6,
            padding: '6px 10px',
            cursor: 'pointer',
          }}
        >
          Sign out
        </button>
      </div>
    </nav>
  );
}

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/auth" element={<AuthPage />} />
        <Route path="/auth/callback" element={<AuthPage />} />
        <Route
          path="/courses"
          element={(
            <ProtectedRoute>
              <NavBar />
              <CoursesList />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/guided"
          element={(
            <ProtectedRoute>
              <NavBar />
              <GuidedSearch />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/questionnaire"
          element={(
            <ProtectedRoute>
              <NavBar />
              <GuidedSearch />
            </ProtectedRoute>
          )}
        />
        <Route path="*" element={<Navigate to="/courses" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
