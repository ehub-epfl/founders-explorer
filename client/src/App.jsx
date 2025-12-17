import { BrowserRouter as Router, Routes, Route, Link, Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import GuidedSearch from './pages/GuidedSearch.jsx';
import CoursesList from "./pages/CoursesList.jsx";
import AuthPage from "./pages/Auth.jsx";
import Compass from "./pages/Compass.jsx";
import ProtectedRoute from "./components/ProtectedRoute.jsx";
import DbFooter from "./components/DbFooter.jsx";
import { useAuth } from "./context/AuthContext.jsx";

function NavBar() {
  const { user, signOut, isGuest } = useAuth();
  const email = user?.email || '';

  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const media = window.matchMedia('(max-width: 768px)');
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  const navLinkStyle = {
    fontFamily: '"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontStyle: 'normal',
    fontWeight: 500,
    fontSize: '16px',
    lineHeight: '145%',
    display: 'flex',
    alignItems: 'center',
    textAlign: 'center',
    letterSpacing: '-0.005em',
    color: '#000000',
    textDecoration: 'none',
  };

  const containerStyle = isMobile
    ? {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '12px 12px 16px',
        width: '100%',
        boxSizing: 'border-box',
        gap: '8px',
        color: '#000000',
      }
    : {
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto',
        alignItems: 'center',
        padding: '24px 64px',
        columnGap: '16px',
        width: '100%',
        maxWidth: '1280px',
        height: '135px',
        marginBottom: '1.5rem',
        color: '#000000',
        boxSizing: 'border-box',
        marginInline: 'auto',
      };

  return (
    <nav style={containerStyle}>
      <div
        style={{
          width: isMobile ? '96px' : '131px',
          height: isMobile ? '54px' : '74px',
          backgroundImage: 'url(/logo-epfl.png)',
          backgroundRepeat: 'no-repeat',
          backgroundSize: 'contain',
          backgroundPosition: 'left center',
          flex: 'none',
          order: 0,
          flexGrow: 0,
        }}
        aria-label="EPFL logo"
      />

      <h1
        style={{
          margin: 0,
          width: isMobile ? '100%' : '532px',
          minHeight: isMobile ? 'auto' : '87px',
          fontFamily: '"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          fontStyle: 'normal',
          fontWeight: 300,
          fontSize: isMobile ? '28px' : '48px',
          lineHeight: '145%',
          display: 'flex',
          alignItems: 'center',
          letterSpacing: '-0.005em',
          color: '#000000',
          textAlign: 'center',
          justifySelf: 'center',
          justifyContent: 'center',
        }}
      >
        Founders’ Explorer
      </h1>

      <div
        style={{
          display: 'flex',
          flexDirection: isMobile ? 'row' : 'row',
          flexWrap: isMobile ? 'wrap' : 'nowrap',
          alignItems: 'center',
          padding: 0,
          gap: isMobile ? '16px' : '32px',
          justifyContent: isMobile ? 'center' : 'flex-end',
          justifySelf: isMobile ? 'center' : 'end',
        }}
      >
        <Link to="/compass" style={navLinkStyle}>
          Compass
        </Link>
        <Link to="/guided" style={navLinkStyle}>
          Guided Search
        </Link>
        <Link to="/courses" style={navLinkStyle}>
          Courses
        </Link>
        {user && !isGuest ? (
          <button
            type="button"
            onClick={() => signOut()}
            style={{
              ...navLinkStyle,
              border: 'none',
              background: 'transparent',
              padding: 0,
              cursor: 'pointer',
            }}
          >
            Log out
          </button>
        ) : (
          <Link to="/auth" style={navLinkStyle}>
            Sign in
          </Link>
        )}
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
              <DbFooter />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/guided"
          element={(
            <ProtectedRoute>
              <NavBar />
              <GuidedSearch />
              <DbFooter />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/compass"
          element={(
            <ProtectedRoute>
              <NavBar />
              <Compass />
              <DbFooter />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/questionnaire"
          element={(
            <ProtectedRoute>
              <NavBar />
              <GuidedSearch />
              <DbFooter />
            </ProtectedRoute>
          )}
        />
        <Route path="*" element={<Navigate to="/compass" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
