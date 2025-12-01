import { BrowserRouter as Router, Routes, Route, Link, Navigate } from "react-router-dom";
import GuidedSearch from './pages/GuidedSearch.jsx';
import CoursesList from "./pages/CoursesList.jsx";
import AuthPage from "./pages/Auth.jsx";
import Compass from "./pages/Compass.jsx";
import ProtectedRoute from "./components/ProtectedRoute.jsx";
import { useAuth } from "./context/AuthContext.jsx";

function NavBar() {
  const { user, signOut } = useAuth();
  const email = user?.email || '';

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

  return (
    <nav
      style={{
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
      }}
    >
      <div
        style={{
          width: '131px',
          height: '74px',
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
          width: '532px',
          height: '87px',
          fontFamily: '"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          fontStyle: 'normal',
          fontWeight: 300,
          fontSize: '48px',
          lineHeight: '145%',
          display: 'flex',
          alignItems: 'center',
          letterSpacing: '-0.005em',
          color: '#000000',
          textAlign: 'center',
          justifySelf: 'center',
        }}
      >
        Founders’ Explorer
      </h1>

      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          padding: 0,
          gap: '32px',
          justifyContent: 'flex-end',
          justifySelf: 'end',
        }}
      >
        <Link to="/courses" style={navLinkStyle}>
          Courses
        </Link>
        <Link to="/guided" style={navLinkStyle}>
          Guided Search
        </Link>
        <Link to="/compass" style={navLinkStyle}>
          Compass
        </Link>
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
          path="/compass"
          element={(
            <ProtectedRoute>
              <NavBar />
              <Compass />
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
