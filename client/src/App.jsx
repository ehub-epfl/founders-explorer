import { BrowserRouter as Router, Routes, Route, Link } from "react-router-dom";
import GuidedSearch from './pages/GuidedSearch.jsx';
import CoursesList from "./pages/CoursesList.jsx";

function App() {
  return (
    <Router>
      <nav
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '12px 0',
          marginBottom: '1.5rem',
          color: 'var(--color-text)',
          borderBottom: '1px solid var(--color-border-subtle)',
        }}
      >
        <img src="/logo.svg" alt="Site logo" style={{ height: '28px' }} />
        <Link to="/courses">Courses</Link>
        <span aria-hidden="true" style={{ color: 'var(--color-border)', fontSize: '0.9rem' }}>|</span>
        <Link to="/guided">Guided Search</Link>
      </nav>
      <Routes>
        <Route path="/courses" element={<CoursesList />} />
        <Route path="/guided" element={<GuidedSearch />} />
        <Route path="/questionnaire" element={<GuidedSearch />} />
      </Routes>
    </Router>
  );
}

export default App;
