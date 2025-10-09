import { BrowserRouter as Router, Routes, Route, Link } from "react-router-dom";
import Questionnaire from './pages/Questionnaire.jsx';
import CoursesList from "./pages/CoursesList.jsx";

function App() {
  return (
    <Router>
      <nav
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '10px 14px',
          marginBottom: '1.5rem',
          borderRadius: 12,
          background: 'var(--color-surface)',
          color: 'var(--color-text)',
          border: '1px solid var(--color-border-subtle)',
          boxShadow: 'var(--shadow-elevation)',
        }}
      >
        <img src="/logo.svg" alt="Site logo" style={{ height: '28px' }} />
        <Link to="/courses">Courses</Link>
        <span aria-hidden="true" style={{ color: 'var(--color-border)', fontSize: '0.9rem' }}>|</span>
        <Link to="/questionnaire">Questionnaire</Link>
      </nav>
      <Routes>
        <Route path="/courses" element={<CoursesList />} />
        <Route path="/questionnaire" element={<Questionnaire />} />
      </Routes>
    </Router>
  );
}

export default App;
