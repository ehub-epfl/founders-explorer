// src/pages/CoursesList.jsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getCourses, getLevelsByDegree } from "../api/courses_api";
import submitCourseRating from "../api/submit_rating";
import {
  MA_PROJECT_LEVELS,
  inferSemesterFromLevel,
  isMAProjectLevel,
  shouldSkipMinorQuestion,
} from "../utils/levels";

const GRID_MIN_WIDTH = 220; // px

const SCORE_FIELDS = [
  { key: 'max_score_relevance_sigmoid', label: 'Relevance to Entrepreneurship' },
  { key: 'max_score_skills_sigmoid', label: 'Skills' },
  { key: 'max_score_product_sigmoid', label: 'Product' },
  { key: 'max_score_venture_sigmoid', label: 'Venture' },
  { key: 'max_score_foundations_sigmoid', label: 'Foundations' },
];

const SCORE_STEP_VALUES = Object.freeze([0, 0.25, 0.5, 0.75, 1]);
const SCORE_STEP_SIZE = SCORE_STEP_VALUES.length > 1 ? SCORE_STEP_VALUES[1] - SCORE_STEP_VALUES[0] : 1;

const MIN_SCORE_SLIDERS = [
  { key: 'minRelevance', label: 'Relevance to Entrepreneurship' },
  { key: 'minSkills', label: 'Skills' },
  { key: 'minProduct', label: 'Product' },
  { key: 'minVenture', label: 'Venture' },
  { key: 'minFoundations', label: 'Foundations' },
];

const TAG_COLORS = [
  '#2563eb', '#059669', '#f97316', '#a855f7', '#ec4899',
  '#14b8a6', '#facc15', '#ef4444', '#6366f1', '#10b981',
];

const DETAIL_ROW_STYLE = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
};

const DETAIL_ICON_STYLE = {
  width: 18,
  height: 18,
  flexShrink: 0,
  marginTop: 2,
  opacity: 0.75,
};

const DETAIL_PLAIN_OFFSET = 26;

const THEME_VARS = Object.freeze({
  surface: 'var(--color-surface)',
  surfaceMuted: 'var(--color-surface-muted)',
  surfaceActive: 'var(--color-surface-active)',
  border: 'var(--color-border)',
  borderSubtle: 'var(--color-border-subtle)',
  text: 'var(--color-text)',
  textMuted: 'var(--color-text-muted)',
  primary: 'var(--color-primary)',
  primaryContrast: 'var(--color-primary-contrast)',
  disabledBg: 'var(--color-disabled-bg)',
  disabledText: 'var(--color-disabled-text)',
  success: 'var(--color-success)',
  successBg: 'var(--color-success-bg)',
  warning: 'var(--color-warning)',
  warningBg: 'var(--color-warning-bg)',
  danger: 'var(--color-danger)',
  dangerBg: 'var(--color-danger-bg)',
});

const selectFieldStyle = (disabled = false) => ({
  width: '100%',
  padding: '6px 8px',
  border: `1px solid ${THEME_VARS.border}`,
  borderRadius: 4,
  background: disabled ? THEME_VARS.disabledBg : THEME_VARS.surface,
  color: disabled ? THEME_VARS.disabledText : THEME_VARS.text,
});

const chipButtonStyle = (active = false) => ({
  padding: '4px 8px',
  border: `1px solid ${THEME_VARS.border}`,
  borderRadius: 6,
  background: active ? THEME_VARS.surfaceActive : THEME_VARS.surface,
  color: THEME_VARS.text,
  cursor: 'pointer',
});

const primaryActionStyle = (enabled = true) => ({
  padding: '8px 12px',
  border: `1px solid ${enabled ? THEME_VARS.primary : THEME_VARS.border}`,
  borderRadius: 6,
  background: enabled ? THEME_VARS.primary : THEME_VARS.disabledBg,
  color: enabled ? THEME_VARS.primaryContrast : THEME_VARS.disabledText,
  cursor: enabled ? 'pointer' : 'not-allowed',
  opacity: enabled ? 1 : 0.65,
  width: '100%',
});

const fieldLabelStyle = { fontSize: 12, marginBottom: 4, color: THEME_VARS.textMuted };
const filterPanelStyle = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '0 10px',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.75rem',
};

function courseKeyOf(course, fallbackIndex = 0) {
  return (
    course?.id ??
    course?.course_code ??
    course?.url ??
    (course?.course_name ? `name:${course.course_name}` : null) ??
    `course-${fallbackIndex}`
  );
}

function colorForTag(tag) {
  if (!tag) return '#4b5563';
  let hash = 0;
  for (let i = 0; i < tag.length; i += 1) {
    hash = (hash << 5) - hash + tag.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % TAG_COLORS.length;
  return TAG_COLORS[index];
}

function tagTextColor(hex) {
  const normalized = hex.replace('#', '');
  const bigint = parseInt(normalized, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance > 170 ? '#111' : '#fff';
}

function clampScore(value) {
  if (!Number.isFinite(value)) return SCORE_STEP_VALUES[0];
  const min = SCORE_STEP_VALUES[0];
  const max = SCORE_STEP_VALUES[SCORE_STEP_VALUES.length - 1];
  return Math.min(max, Math.max(min, value));
}

function snapToScoreStep(value) {
  const clamped = clampScore(value);
  const steps = SCORE_STEP_VALUES.length - 1;
  if (steps <= 0) return clamped;
  const index = Math.round(clamped * steps);
  return SCORE_STEP_VALUES[index] ?? SCORE_STEP_VALUES[0];
}

function getScoreStepIndex(value) {
  const snapped = snapToScoreStep(value);
  const index = SCORE_STEP_VALUES.findIndex((option) => option === snapped);
  return index >= 0 ? index : Math.round(snapped * (SCORE_STEP_VALUES.length - 1));
}

function formatScoreLevelLabel(value) {
  const index = getScoreStepIndex(value);
  return `Level ${index + 1}`;
}

function renderLevelTags(levels) {
  if (!Array.isArray(levels) || levels.length === 0) return null;
  const uniqueLevels = Array.from(new Set(levels.map((name) => name?.trim()).filter(Boolean)));
  if (uniqueLevels.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
      {uniqueLevels.map((name) => {
        const color = colorForTag(name);
        return (
          <span
            key={name}
            style={{
              background: color,
              color: tagTextColor(color),
              padding: '2px 8px',
              borderRadius: 999,
              fontSize: 10,
              fontWeight: 600,
              opacity: 0.85,
            }}
          >
            {name}
          </span>
        );
      })}
    </div>
  );
}

function renderProgramTags(programs) {
  if (!Array.isArray(programs) || programs.length === 0) return null;
  const uniquePrograms = Array.from(new Set(programs.map((name) => name?.trim()).filter(Boolean)));
  if (uniquePrograms.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
      {uniquePrograms.map((name) => {
        const color = colorForTag(name);
        return (
          <span
            key={name}
            style={{
              background: color,
              color: tagTextColor(color),
              padding: '2px 8px',
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            {name}
          </span>
        );
      })}
    </div>
  );
}

function renderIconRow(icon, label, content, key, inline = true) {
  const src = icon.startsWith('/') ? icon : `/${icon}`;
  if (inline) {
    return (
      <li key={key} style={DETAIL_ROW_STYLE}>
        <img src={src} alt={label} style={DETAIL_ICON_STYLE} />
        <span style={{ lineHeight: 1.5 }}>
          
          {content}
        </span>
      </li>
    );
  }

  return (
    <li key={key} style={DETAIL_ROW_STYLE}>
      <img src={src} alt={label} style={DETAIL_ICON_STYLE} />
      <div style={{ lineHeight: 1.5 }}>{content}</div>
    </li>
  );
}

function renderPlainRow(label, content, key) {
  return (
    <li key={key} style={{ marginLeft: DETAIL_PLAIN_OFFSET, lineHeight: 1.5 }}>
      
      {content}
    </li>
  );
}

function renderTeachers(entries, fallbackNames) {
  const normalized = [];
  const seen = new Set();

  if (Array.isArray(entries)) {
    for (const entry of entries) {
      const name = typeof entry?.name === 'string' ? entry.name.trim() : '';
      const url = typeof entry?.url === 'string' ? entry.url.trim() : '';
      if (!name) continue;
      const key = `${name}::${url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      normalized.push({ name, url });
    }
  }

  if (!normalized.length && Array.isArray(fallbackNames)) {
    for (const candidate of fallbackNames) {
      const cleaned = typeof candidate === 'string' ? candidate.trim() : '';
      if (!cleaned) continue;
      if (seen.has(`${cleaned}::`)) continue;
      seen.add(`${cleaned}::`);
      normalized.push({ name: cleaned, url: '' });
    }
  }

  if (!normalized.length) return null;

  const content = normalized.map((teacher, index) => {
    const anchor = teacher.url ? (
      <a href={teacher.url} target="_blank" rel="noreferrer">
        {teacher.name}
      </a>
    ) : (
      teacher.name
    );
    return (
      <span key={`${teacher.name}-${teacher.url || index}`}>
        {index > 0 ? ', ' : ''}
        {anchor}
      </span>
    );
  });

  return renderIconRow(
    'teacher.svg',
    normalized.length > 1 ? 'Teachers' : 'Teacher',
    content,
    'teachers'
  );
}

function splitScheduleLines(value) {
  if (typeof value !== 'string') return [];
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function buildCourseDetailRows(course, scheduleLines) {
  const rows = [];

  const teacherRow = renderTeachers(course.teachers, course.teacher_names);
  if (teacherRow) rows.push(teacherRow);

  if (course.section) {
    rows.push(renderIconRow('section.svg', 'Section', course.section, 'section'));
  }

  if (Number.isFinite(course.credits) || course.credits) {
    rows.push(renderIconRow('credits.svg', 'Credits', course.credits, 'credits'));
  }

  if (course.type) {
    rows.push(renderIconRow('type.svg', 'Type', course.type, 'type'));
  }

  if (course.semester) {
    rows.push(renderIconRow('semester.svg', 'Semester', course.semester, 'semester'));
  }

  if (scheduleLines.length) {
    const scheduleContent = scheduleLines.map((line, lineIdx) => (
      <span key={`schedule-line-${lineIdx}`} style={{ display: 'block' }}>
        {line}
      </span>
    ));
    rows.push(renderIconRow('schedule.svg', 'Schedule', scheduleContent, 'schedule', false));
  }

  if (course.exam_form) {
    rows.push(renderPlainRow('Exam', course.exam_form, 'exam'));
  }

  if (course.workload) {
    rows.push(renderPlainRow('Workload', course.workload, 'workload'));
  }

  return rows;
}

const createDefaultFilters = () => ({
  query: "",
  type: "",
  semester: "",
  creditsMin: "",
  creditsMax: "",
  minRelevance: SCORE_STEP_VALUES[0],
  minSkills: SCORE_STEP_VALUES[0],
  minProduct: SCORE_STEP_VALUES[0],
  minVenture: SCORE_STEP_VALUES[0],
  minFoundations: SCORE_STEP_VALUES[0],
  degree: "",
  level: "",
  major: "",
  minor: "",
});

const FILTER_KEYS = Object.keys(createDefaultFilters());

function parseFiltersFromSearch(search) {
  const base = createDefaultFilters();
  if (!search) return base;
  const sp = new URLSearchParams(search);
  base.degree = sp.get('degree') || '';
  base.level = sp.get('level') || '';
  base.major = sp.get('major') || '';
  base.type = sp.get('type') || '';
  base.semester = sp.get('semester') || '';
  if (base.semester.toLowerCase() === 'winter') base.semester = 'Fall';
  if (base.semester.toLowerCase() === 'summer') base.semester = 'Spring';
  base.minor = sp.get('minor') || '';
  if (base.level && !base.semester) {
    base.semester = inferSemesterFromLevel(base.level) || '';
  }
  if (base.level.toLowerCase().includes('project')) {
    base.minor = '';
  }
  const creditsMinParam = sp.get('creditsMin');
  if (creditsMinParam !== null) base.creditsMin = creditsMinParam;
  const creditsMaxParam = sp.get('creditsMax');
  if (creditsMaxParam !== null) base.creditsMax = creditsMaxParam;

  const parseScore = (value) => {
    if (value === null) return undefined;
    const num = Number(value);
    return Number.isFinite(num) ? num : undefined;
  };

  const minRelevanceParam = parseScore(sp.get('minRelevance'));
  if (minRelevanceParam !== undefined) base.minRelevance = snapToScoreStep(minRelevanceParam);
  const minSkillsParam = parseScore(sp.get('minSkills'));
  if (minSkillsParam !== undefined) base.minSkills = snapToScoreStep(minSkillsParam);
  const minProductParam = parseScore(sp.get('minProduct'));
  if (minProductParam !== undefined) base.minProduct = snapToScoreStep(minProductParam);
  const minVentureParam = parseScore(sp.get('minVenture'));
  if (minVentureParam !== undefined) base.minVenture = snapToScoreStep(minVentureParam);
  const minFoundationsParam = parseScore(sp.get('minFoundations'));
  if (minFoundationsParam !== undefined) base.minFoundations = snapToScoreStep(minFoundationsParam);
  return base;
}

function filtersAreEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  for (const key of FILTER_KEYS) {
    const va = a[key];
    const vb = b[key];
    if (Number.isFinite(va) || Number.isFinite(vb)) {
      if (Number(va) !== Number(vb)) return false;
    } else if ((va ?? '') !== (vb ?? '')) {
      return false;
    }
  }
  return true;
}

function getDegreeOptions(tree) {
  if (!tree || typeof tree !== 'object') return [];
  return Object.keys(tree);
}

function getLevelOptions(tree, degree) {
  if (!tree || !degree || !tree[degree]) return [];
  const keys = Object.keys(tree[degree] || {});
  const base = keys
    .filter((lvl) => /^[A-Za-z]+\d+$/i.test(lvl))
    .sort();
  if (degree !== 'MA') {
    return base;
  }
  const result = base.slice();
  for (const level of MA_PROJECT_LEVELS) {
    if (!result.includes(level)) {
      result.push(level);
    }
  }
  return result;
}

function collectMajorsFromBucket(bucket) {
  const result = new Set();
  if (!bucket || typeof bucket !== 'object') return result;
  for (const value of Object.values(bucket)) {
    if (Array.isArray(value)) {
      for (const name of value) {
        if (typeof name === 'string' && name.trim()) {
          result.add(name.trim());
        }
      }
    }
  }
  return result;
}

function getMajorOptions(tree, degree, level) {
  if (!tree || typeof tree !== 'object') return [];
  const majors = new Set();

  if (degree === 'PhD') {
    const list = Array.isArray(tree.PhD?.['Doctoral School'])
      ? tree.PhD['Doctoral School']
      : [];
    for (const name of list) {
      if (typeof name === 'string' && name.trim()) {
        majors.add(name.trim());
      }
    }
    return Array.from(majors).sort();
  }

  if (degree && level) {
    const bucket = tree[degree];
    const list = Array.isArray(bucket?.[level]) ? bucket[level] : [];
    for (const name of list) {
      if (typeof name === 'string' && name.trim()) {
        majors.add(name.trim());
      }
    }
    if (majors.size > 0) {
      return Array.from(majors).sort();
    }
  }

  if (degree) {
    const bucket = tree[degree];
    for (const name of collectMajorsFromBucket(bucket)) {
      majors.add(name);
    }
    return Array.from(majors).sort();
  }

  for (const [deg, bucket] of Object.entries(tree)) {
    if (deg === 'PhD') {
      const list = Array.isArray(bucket?.edoc) ? bucket.edoc : [];
      for (const name of list) {
        if (typeof name === 'string' && name.trim()) {
          majors.add(name.trim());
        }
      }
    } else {
      for (const name of collectMajorsFromBucket(bucket)) {
        majors.add(name);
      }
    }
  }

  return Array.from(majors).sort();
}

function withValueOption(options, value) {
  if (!value) return options;
  if (options.includes(value)) return options;
  return [...options, value];
}

function getMinorOptions(tree, degree, level) {
  if (!tree || degree !== 'MA') return [];
  if (isMAProjectLevel(level)) return [];
  const source = tree.MA || {};
  const autumn = Array.isArray(source['Minor Fall Semester']) ? source['Minor Fall Semester'] : [];
  const spring = Array.isArray(source['Minor Spring Semester']) ? source['Minor Spring Semester'] : [];
  if (!level) {
    return Array.from(new Set([...autumn, ...spring])).sort();
  }
  const match = level.match(/^MA(\d+)/i);
  if (match) {
    const idx = Number(match[1]);
    if (Number.isFinite(idx)) {
      return (idx % 2 === 1 ? autumn : spring).slice().sort();
    }
  }
  if (level.toLowerCase().includes('autumn') || level.toLowerCase().includes('fall')) return autumn.slice().sort();
  if (level.toLowerCase().includes('spring')) return spring.slice().sort();
  return Array.from(new Set([...autumn, ...spring])).sort();
}

function adjustLevelForSemester(level, degree, semester) {
  if (!level || !semester) return level;
  const match = level.match(/^([A-Za-z]+)(\d+)$/);
  if (match) {
    const prefix = match[1];
    let num = Number(match[2]);
    if (Number.isFinite(num)) {
      if (semester === 'Fall' && num % 2 === 0) {
        num = Math.max(1, num - 1);
      } else if (semester === 'Spring' && num % 2 === 1) {
        num = num + 1;
      }
      return `${prefix}${num}`;
    }
  }
  if (degree === 'MA' && level.toLowerCase().includes('minor')) {
    if (semester === 'Fall' && level.toLowerCase().includes('spring')) {
      return level.replace(/Spring/i, 'Fall');
    }
    if (semester === 'Spring' && (level.toLowerCase().includes('autumn') || level.toLowerCase().includes('fall'))) {
      return level.replace(/Autumn|Fall/i, 'Spring');
    }
  }
  return level;
}

function normalizeScore(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (num < 0) return 0;
  if (num > 1) return 1;
  return num;
}

function ScoreSummary({
  course,
  theme = 'light',
  layout = 'list',
  submissionState,
  onSubmissionStateChange,
  savedValues,
  onValuesChange,
}) {
  const base = {
    relevance: normalizeScore(course?.max_score_relevance_sigmoid),
    skills: normalizeScore(course?.max_score_skills_sigmoid),
    product: normalizeScore(course?.max_score_product_sigmoid),
    venture: normalizeScore(course?.max_score_venture_sigmoid),
    foundations: normalizeScore(course?.max_score_foundations_sigmoid),
  };

  const snapValueOrDefault = (value) => {
    const numeric = Number(value);
    return snapToScoreStep(Number.isFinite(numeric) ? numeric : SCORE_STEP_VALUES[0]);
  };

  const withSnappedValues = (candidate) => ({
    relevance: snapValueOrDefault(candidate?.relevance),
    skills: snapValueOrDefault(candidate?.skills),
    product: snapValueOrDefault(candidate?.product),
    venture: snapValueOrDefault(candidate?.venture),
    foundations: snapValueOrDefault(candidate?.foundations),
  });

  const defaultValues = useMemo(() => ({
    relevance: snapValueOrDefault(base.relevance),
    skills: snapValueOrDefault(base.skills),
    product: snapValueOrDefault(base.product),
    venture: snapValueOrDefault(base.venture),
    foundations: snapValueOrDefault(base.foundations),
  }), [base.relevance, base.skills, base.product, base.venture, base.foundations]);

  const pendingValuesRef = useRef(null);
  const [values, setValues] = useState(withSnappedValues(savedValues ?? defaultValues));
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(Boolean(submissionState?.submitted));
  const [submitError, setSubmitError] = useState('');

  useEffect(() => {
    setSubmitted(Boolean(submissionState?.submitted));
  }, [submissionState]);

  useEffect(() => {
    const nextValues = withSnappedValues(savedValues ?? defaultValues);
    setValues(nextValues);
    if (!savedValues && typeof onValuesChange === 'function') {
      onValuesChange(nextValues);
    }
    setSubmitError('');
  }, [course?.id, course?.course_code, defaultValues, savedValues]);

  useEffect(() => {
    if (typeof onValuesChange !== 'function') {
      pendingValuesRef.current = null;
      return;
    }
    const next = pendingValuesRef.current;
    if (!next) return;
    pendingValuesRef.current = null;
    onValuesChange(next);
  }, [values, onValuesChange]);

  const rows = [
    { key: 'relevance', label: 'Relevance to Entrepreneurship', color: '#0ea5e9', base: base.relevance },
    { key: 'skills', label: 'Skills', color: '#2563eb', base: base.skills },
    { key: 'product', label: 'Product', color: '#10b981', base: base.product },
    { key: 'venture', label: 'Venture', color: '#f59e0b', base: base.venture },
    { key: 'foundations', label: 'Foundations', color: '#a855f7', base: base.foundations },
  ];

  const isDark = theme === 'dark';
  const labelColor = isDark ? 'rgba(255,255,255,0.85)' : THEME_VARS.textMuted;
  const tickColor = isDark ? 'rgba(255,255,255,0.35)' : 'rgba(15,23,42,0.25)';

  const broadcastState = (state) => {
    if (typeof onSubmissionStateChange === 'function') {
      onSubmissionStateChange(state);
    }
  };

  const handleValueChange = (key, nextValue) => {
    const snapped = snapToScoreStep(nextValue);
    setValues((prev) => {
      if (prev[key] === snapped) {
        return prev;
      }
      const updated = { ...prev, [key]: snapped };
      if (typeof onValuesChange === 'function') {
        pendingValuesRef.current = updated;
      }
      return updated;
    });
    if (submitted) {
      setSubmitted(false);
      broadcastState(null);
    }
    if (submitError) {
      setSubmitError('');
    }
  };

  async function handleSubmit() {
    if (submitting) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      await submitCourseRating({
        course_id: course?.id ?? null,
        course_code: course?.course_code ?? null,
        score_relevance: Math.max(0, Math.min(1, values.relevance ?? 0)),
        score_skills: Math.max(0, Math.min(1, values.skills ?? 0)),
        score_product: Math.max(0, Math.min(1, values.product ?? 0)),
        score_venture: Math.max(0, Math.min(1, values.venture ?? 0)),
        score_foundations: Math.max(0, Math.min(1, values.foundations ?? 0)),
      });
      setSubmitted(true);
      broadcastState({ submitted: true, timestamp: Date.now() });
    } catch (err) {
      setSubmitError(err?.message || 'Submit failed');
      broadcastState(null);
    } finally {
      setSubmitting(false);
    }
  }

  // status button color (right side)
  const status = submitError ? 'error' : (submitting ? 'submitting' : (submitted ? 'success' : 'idle'));
  const statusStyles = {
    idle:   { bg: THEME_VARS.surfaceMuted, border: THEME_VARS.border },
    submitting: { bg: THEME_VARS.warningBg, border: THEME_VARS.warning },
    success: { bg: THEME_VARS.successBg, border: THEME_VARS.success },
    error:   { bg: THEME_VARS.dangerBg, border: THEME_VARS.danger },
  }[status];

  // Layout helpers
  const isListLayout = layout === 'list';
  const gridColumns = isListLayout
    ? Math.min(rows.length, 5)
    : Math.min(rows.length, 3);

  return (
    <div style={{
      marginTop: 10,
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      flexWrap: 'wrap',
    }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))`,
        gridAutoRows: 'minmax(40px, auto)',
        gap: 6,
        padding: 0,
        border: 'none',
        borderRadius: 0,
        width: '100%',
        flex: 1,
        minWidth: 0
      }}>
        {rows.map((r) => (
          <div key={r.key} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ fontSize: 10, color: labelColor, fontWeight: 600, opacity: 0.85 }}>{r.label}</div>
            <div
              title={`You: ${values[r.key].toFixed(2)} • Data: ${r.base != null ? r.base.toFixed(2) : '–'}`}
              aria-label={`${r.label} slider`}
              style={{ position: 'relative', height: 16 }}
            >
              <div
                aria-hidden
                style={{
                  position: 'absolute', left: 0, right: 0, top: '50%', transform: 'translateY(-50%)',
                  height: 4, borderRadius: 9999, background: '#e5e7eb', overflow: 'hidden', zIndex: 1,
                }}
              >
                <div style={{ width: r.base != null ? `${Math.round(r.base * 100)}%` : '0%', height: '100%', background: '#9ca3af' }} />
              </div>
              <div
                aria-hidden
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: 0,
                  bottom: 0,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '0 1px',
                  pointerEvents: 'none',
                  zIndex: 2,
                }}
              >
                {SCORE_STEP_VALUES.map((_, idx) => (
                  <span
                    key={idx}
                    style={{
                      width: 1,
                      height: 10,
                      background: tickColor,
                      opacity: idx === 0 || idx === SCORE_STEP_VALUES.length - 1 ? 0.45 : 0.35,
                    }}
                  />
                ))}
              </div>
              <div
                aria-hidden
                style={{
                  position: 'absolute', left: 0, right: 0, top: '50%', transform: 'translateY(-50%)',
                  height: 4, borderRadius: 9999, overflow: 'hidden', zIndex: 3, pointerEvents: 'none',
                }}
              >
                <div style={{ width: `${Math.round(values[r.key] * 100)}%`, height: '100%', background: r.color, opacity: 1 }} />
              </div>
              <input
                type="range"
                min={SCORE_STEP_VALUES[0]}
                max={SCORE_STEP_VALUES[SCORE_STEP_VALUES.length - 1]}
                step={SCORE_STEP_SIZE}
                value={snapToScoreStep(values[r.key])}
                onChange={(e) => handleValueChange(r.key, Number(e.target.value))}
                className="score-slider"
                style={{
                  position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
                  width: '100%', background: 'transparent', color: r.color, zIndex: 4,
                }}
              />
            </div>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="score-submit-btn"
        onClick={handleSubmit}
        disabled={submitting}
        aria-label="Submit score values"
        title={submitError ? `Submit failed: ${submitError}` : (submitted ? 'Saved' : (submitting ? 'Submitting…' : 'Submit'))}
        style={{
          width: 22, height: 22, borderRadius: 9999,
          background: statusStyles.bg,
          border: `1px solid ${statusStyles.border}`,
          cursor: submitting ? 'not-allowed' : 'pointer',
        }}
      />
    </div>
  );
}

// InteractiveScoreSliders was merged into ScoreSummary to avoid duplicate sliders

// Pareto helpers: maximize credits, minimize workload
function parseNumberLike(value) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return NaN;
  const m = value.match(/[-+]?[0-9]*\.?[0-9]+/);
  return m ? Number(m[0]) : NaN;
}

function creditsOf(c) {
  const n = parseNumberLike(c?.credits);
  return Number.isFinite(n) ? n : 0; // default low credits if missing
}

function workloadOf(c) {
  const n = parseNumberLike(c?.workload);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY; // default very high if missing
}

function dominates(a, b, pref) {
  // pref: { credits: 'max'|'min', workload: 'max'|'min' }
  const cmp = (va, vb, want) => want === 'max' ? (va >= vb) : (va <= vb);
  const strict = (va, vb, want) => want === 'max' ? (va > vb) : (va < vb);
  const betterOrEqualCredits = cmp(a.credits, b.credits, pref.credits);
  const betterOrEqualWork = cmp(a.workload, b.workload, pref.workload);
  const oneStrict = strict(a.credits, b.credits, pref.credits) || strict(a.workload, b.workload, pref.workload);
  return betterOrEqualCredits && betterOrEqualWork && oneStrict;
}

function computeParetoRanks(items, pref) {
  // items: array of { idx, credits, workload }
  const n = items.length;
  const dominatedByCount = new Array(n).fill(0);
  const dominatesList = Array.from({ length: n }, () => []);

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      if (dominates(items[i], items[j], pref)) {
        dominatesList[i].push(j);
      } else if (dominates(items[j], items[i], pref)) {
        dominatedByCount[i]++;
      }
    }
  }

  const fronts = [];
  let current = [];
  for (let i = 0; i < n; i++) if (dominatedByCount[i] === 0) current.push(i);
  let rank = 0;
  const ranks = new Array(n).fill(Infinity);
  while (current.length) {
    fronts.push(current);
    const next = [];
    for (const i of current) {
      ranks[i] = rank;
      for (const j of dominatesList[i]) {
        dominatedByCount[j]--;
        if (dominatedByCount[j] === 0) next.push(j);
      }
    }
    current = next;
    rank++;
  }
  return ranks; // if some remain Infinity (shouldn't), treat as worst
}

function colorForRank(rank, maxRank) {
  const baseHue = 210; // blue
  const sat = 70; // percent
  const minL = 25; // darkest for best
  const maxL = 90; // lightest for worst
  const t = maxRank <= 0 ? 0 : rank / maxRank; // 0..1
  const l = Math.round(minL + t * (maxL - minL));
  return `hsl(${baseHue} ${sat}% ${l}%)`;
}

function textColorForBgHslLightness(lightness) {
  // simple contrast heuristic
  return lightness < 55 ? '#fff' : '#111';
}

function CoursesList() {
  const location = useLocation();
  const navigate = useNavigate();
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(30);
  const [totalResults, setTotalResults] = useState(0);
  const [showFilters, setShowFilters] = useState(true);
  const [programsTree, setProgramsTree] = useState(null);
  const [levelsMap, setLevelsMap] = useState({});
  const [appliedFilters, setAppliedFilters] = useState(() => parseFiltersFromSearch(location.search));
  const [draftFilters, setDraftFilters] = useState(() => parseFiltersFromSearch(location.search));
  const [sortField, setSortField] = useState("");
  const [sortOrder, setSortOrder] = useState("asc");
  const [viewMode, setViewMode] = useState("list"); // 'list' | 'grid'
  const [paretoPref, setParetoPref] = useState({ credits: 'max', workload: 'min' }); // 'max'|'min' for each
  const [submissionStates, setSubmissionStates] = useState({});
  const [ratingValues, setRatingValues] = useState({});

  const updateSubmissionState = useCallback((courseKey, state) => {
    if (!courseKey) return;
    setSubmissionStates((prev) => {
      if (state == null) {
        if (!(courseKey in prev)) return prev;
        const { [courseKey]: _omit, ...rest } = prev;
        return rest;
      }
      return { ...prev, [courseKey]: state };
    });
  }, []);

  const updateRatingValues = useCallback((courseKey, values) => {
    if (!courseKey) return;
    setRatingValues((prev) => {
      if (!values) {
        if (!(courseKey in prev)) return prev;
        const { [courseKey]: _omit, ...rest } = prev;
        return rest;
      }
      return { ...prev, [courseKey]: values };
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadProgramsTree() {
      try {
        const response = await fetch('/programs_tree.json', { cache: 'no-store' });
        if (!response.ok) {
          throw new Error(`Failed to fetch programs_tree.json: ${response.status}`);
        }
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          const snippet = await response.text();
          throw new Error(`Unexpected content-type: ${contentType}. Body starts with: ${snippet.slice(0, 60)}`);
        }
        const json = await response.json();
        if (!cancelled) {
          setProgramsTree(json);
        }
      } catch (err) {
        if (!cancelled) {
          setProgramsTree(null);
          console.warn('Failed to load programs_tree.json', err);
        }
      }
    }
    loadProgramsTree();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let active = true;
    async function loadLevels() {
      try {
        const map = await getLevelsByDegree();
        if (active) {
          setLevelsMap(map);
        }
      } catch (err) {
        console.warn('Failed to load degree levels from Supabase', err);
      }
    }
    loadLevels();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const inferred = inferSemesterFromLevel(appliedFilters.level);
    const fallback = appliedFilters.semester || '';
    const finalSemester = inferred || fallback;
    if (finalSemester && finalSemester !== appliedFilters.semester) {
      setAppliedFilters((prev) => ({ ...prev, semester: finalSemester }));
      setDraftFilters((prev) => ({ ...prev, semester: finalSemester }));
    }
  }, [appliedFilters.level]);

useEffect(() => {
    const parsed = parseFiltersFromSearch(location.search);
    setAppliedFilters((prev) => (filtersAreEqual(prev, parsed) ? prev : parsed));
  }, [location.search]);

  useEffect(() => {
    setDraftFilters(appliedFilters);
  }, [appliedFilters]);

  useEffect(() => {
    const params = new URLSearchParams();

    if (appliedFilters.degree) params.set('degree', appliedFilters.degree);
    if (appliedFilters.level) params.set('level', appliedFilters.level);
    if (appliedFilters.major) params.set('major', appliedFilters.major);
    if (appliedFilters.minor) params.set('minor', appliedFilters.minor);
    if (appliedFilters.type) params.set('type', appliedFilters.type);
    if (appliedFilters.semester) params.set('semester', appliedFilters.semester);
    if (appliedFilters.creditsMin !== '') params.set('creditsMin', appliedFilters.creditsMin);
    if (appliedFilters.creditsMax !== '') params.set('creditsMax', appliedFilters.creditsMax);
    const setScoreParam = (key, value) => {
      if (Number(value) > 0) params.set(key, String(value));
    };
    setScoreParam('minRelevance', appliedFilters.minRelevance);
    setScoreParam('minSkills', appliedFilters.minSkills);
    setScoreParam('minProduct', appliedFilters.minProduct);
    setScoreParam('minVenture', appliedFilters.minVenture);
    setScoreParam('minFoundations', appliedFilters.minFoundations);

    const nextSearch = params.toString();
    const next = nextSearch ? `?${nextSearch}` : '';
    if (location.search !== next) {
      navigate({ pathname: location.pathname, search: next }, { replace: true });
    }
  }, [appliedFilters, location.pathname, location.search, navigate]);

  const filtersDirty = useMemo(
    () => draftFilters.query !== appliedFilters.query,
    [draftFilters.query, appliedFilters.query],
  );

  const degreeOptions = useMemo(
    () => withValueOption(getDegreeOptions(programsTree), draftFilters.degree),
    [programsTree, draftFilters.degree],
  );

  const levelOptions = useMemo(
    () => {
      const degree = draftFilters.degree;
      if (degree) {
        const supaLevels = levelsMap[degree.toUpperCase()];
        if (supaLevels && supaLevels.length) {
          return withValueOption(supaLevels, draftFilters.level);
        }
      }
      return withValueOption(getLevelOptions(programsTree, degree), draftFilters.level);
    },
    [levelsMap, programsTree, draftFilters.degree, draftFilters.level],
  );

  const majorOptions = useMemo(
    () => withValueOption(getMajorOptions(programsTree, draftFilters.degree, draftFilters.level), draftFilters.major),
    [programsTree, draftFilters.degree, draftFilters.level, draftFilters.major],
  );

  const minorOptions = useMemo(
    () => withValueOption(getMinorOptions(programsTree, draftFilters.degree, draftFilters.level), draftFilters.minor),
    [programsTree, draftFilters.degree, draftFilters.level, draftFilters.minor],
  );

  const isPhD = draftFilters.degree === 'PhD';
  const levelDisabled = !draftFilters.degree || isPhD || levelOptions.length === 0;
  const majorDisabled = majorOptions.length === 0;
  const skipMinorFilters = shouldSkipMinorQuestion(draftFilters.degree, draftFilters.level);
  const minorDisabled = skipMinorFilters || !draftFilters.degree || minorOptions.length === 0;

  const handleApplyFilters = () => {
    setPage(1);
    setAppliedFilters((prev) => ({ ...prev, query: draftFilters.query }));
  };

  const handleClearFilters = () => {
    const reset = createDefaultFilters();
    setDraftFilters(reset);
    setAppliedFilters(reset);
    setPage(1);
  };

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const params = {
          page,
          pageSize,
          // map UI filters to backend query params
          q: appliedFilters.query || undefined,
          type: appliedFilters.type || undefined,
          semester: appliedFilters.semester || undefined,
          degree: appliedFilters.degree || undefined,
          creditsMin: appliedFilters.creditsMin !== "" ? Number(appliedFilters.creditsMin) : undefined,
          creditsMax: appliedFilters.creditsMax !== "" ? Number(appliedFilters.creditsMax) : undefined,
          level: appliedFilters.level || undefined,
          major: appliedFilters.major || undefined,
          minor: appliedFilters.minor || undefined,
          sortField: sortField || undefined,
          sortOrder: sortField ? sortOrder : undefined,
          minRelevance: appliedFilters.minRelevance > 0 ? appliedFilters.minRelevance : undefined,
          minSkills: appliedFilters.minSkills > 0 ? appliedFilters.minSkills : undefined,
          minProduct: appliedFilters.minProduct > 0 ? appliedFilters.minProduct : undefined,
          minVenture: appliedFilters.minVenture > 0 ? appliedFilters.minVenture : undefined,
          minFoundations: appliedFilters.minFoundations > 0 ? appliedFilters.minFoundations : undefined,
        };
        const data = await getCourses(params);
        console.log("API response:", data);
        setCourses(data.items || []);
        setTotalResults(Number(data.total || 0));
        if (!data.items || data.items.length === 0) {
          console.debug('No course results returned for current filters');
        }
      } catch (err) {
        setError(err?.message || "Failed to load courses");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [page, pageSize, appliedFilters, sortField, sortOrder]);

  useEffect(() => {
    setPage(1);
  }, [appliedFilters, sortField, sortOrder]);

  return (
    <div style={{ display: "flex", gap: "1rem" }}>
      {/* Left Filter Bar */}
      <aside
        style={{
          width: showFilters ? 'clamp(220px, 26vw, 320px)' : 0,
          flex: showFilters ? '0 0 clamp(220px, 26vw, 320px)' : '0 0 0',
          boxSizing: 'border-box',
          transition: "width 0.2s ease",
          position: "sticky",
          top: 0,
          height: "100vh",
          alignSelf: "flex-start",
          overflowY: showFilters ? "auto" : "hidden",
          overflowX: "hidden",
          borderRight: `1px solid ${THEME_VARS.borderSubtle}`,
          paddingRight: showFilters ? "1rem" : 0,
          marginRight: showFilters ? "1rem" : 0,
        }}
      >
        <div style={filterPanelStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <h3 style={{ margin: 0 }}>Filters</h3>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                onClick={handleClearFilters}
                style={{
                  background: THEME_VARS.surfaceMuted,
                  border: `1px solid ${THEME_VARS.border}`,
                  color: THEME_VARS.text,
                  padding: '4px 8px',
                  borderRadius: 4,
                }}
              >
                Clear filters
              </button>
              <button onClick={() => setShowFilters(false)}>Hide</button>
            </div>
          </div>
          <div style={{ display: "grid", gap: "0.75rem" }}>
            <input
              type="text"
              placeholder="Search name/code/prof"
              value={draftFilters.query}
              onChange={(e) => setDraftFilters((f) => ({ ...f, query: e.target.value }))}
              style={{ width: '100%' }}
            />
            <button
              type="button"
              onClick={handleApplyFilters}
              disabled={!filtersDirty}
              style={primaryActionStyle(filtersDirty)}
            >
              Search
            </button>
            <div>
              <div style={fieldLabelStyle}>Degree</div>
              <select
                value={draftFilters.degree}
                onChange={(e) => {
                  const nextDegree = e.target.value;
                  setDraftFilters((prev) => ({
                    ...prev,
                    degree: nextDegree,
                    level: '',
                    major: '',
                    minor: '',
                  }));
                  setAppliedFilters((prev) => ({
                    ...prev,
                    degree: nextDegree,
                    level: '',
                    major: '',
                    minor: '',
                  }));
                }}
                style={selectFieldStyle(false)}
              >
                <option value="">Any degree</option>
                {degreeOptions.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>
            <div>
              <div style={fieldLabelStyle}>Level</div>
              <select
                value={draftFilters.level}
                onChange={(e) => {
                  const nextLevel = e.target.value;
                  const inferredSemester = inferSemesterFromLevel(nextLevel);
                  setDraftFilters((prev) => ({
                    ...prev,
                    level: nextLevel,
                    major: '',
                    minor: '',
                    semester: inferredSemester || prev.semester,
                  }));
                  setAppliedFilters((prev) => ({
                    ...prev,
                    level: nextLevel,
                    major: '',
                    minor: '',
                    semester: inferredSemester || prev.semester,
                  }));
                }}
                disabled={levelDisabled}
                style={selectFieldStyle(levelDisabled)}
              >
                <option value="">Any level</option>
                {levelOptions.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>
            <div>
              <div style={fieldLabelStyle}>Major</div>
              <select
                value={draftFilters.major}
                onChange={(e) => {
                  const nextMajor = e.target.value;
                  setDraftFilters((prev) => ({
                    ...prev,
                    major: nextMajor,
                  }));
                  setAppliedFilters((prev) => ({
                    ...prev,
                    major: nextMajor,
                  }));
                }}
                disabled={majorDisabled}
                style={selectFieldStyle(majorDisabled)}
              >
                <option value="">Any major</option>
                {majorOptions.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>
            <div>
              <div style={fieldLabelStyle}>Minor</div>
              <select
                value={draftFilters.minor}
                onChange={(e) => {
                  const nextMinor = e.target.value;
                  setDraftFilters((prev) => ({
                    ...prev,
                    minor: nextMinor,
                  }));
                  setAppliedFilters((prev) => ({
                    ...prev,
                    minor: nextMinor,
                  }));
                }}
                disabled={minorDisabled}
                style={selectFieldStyle(minorDisabled)}
              >
                <option value="">No minor preference</option>
                {minorOptions.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>
            <div>
              <div style={fieldLabelStyle}>Type</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  onClick={() => {
                    setDraftFilters((prev) => {
                      const nextType = prev.type === "optional" ? "" : "optional";
                      const next = { ...prev, type: nextType };
                      setAppliedFilters((applied) => ({ ...applied, type: nextType }));
                      return next;
                    });
                  }}
                  style={chipButtonStyle(draftFilters.type === "optional")}
                >
                  Optional
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDraftFilters((prev) => {
                      const nextType = prev.type === "mandatory" ? "" : "mandatory";
                      const next = { ...prev, type: nextType };
                      setAppliedFilters((applied) => ({ ...applied, type: nextType }));
                      return next;
                    });
                  }}
                  style={chipButtonStyle(draftFilters.type === "mandatory")}
                >
                  Mandatory
                </button>
              </div>
            </div>
          <div>
            <div style={fieldLabelStyle}>Semester</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={() => {
                  setDraftFilters((prev) => {
                    const nextSemester = prev.semester === "Fall" ? "" : "Fall";
                    let nextLevel = prev.level;
                    if (nextSemester) {
                      nextLevel = adjustLevelForSemester(prev.level, prev.degree, nextSemester);
                    }
                    const next = { ...prev, semester: nextSemester, level: nextLevel };
                    setAppliedFilters((applied) => ({ ...applied, semester: nextSemester, level: nextLevel }));
                    return next;
                  });
                }}
                style={chipButtonStyle(draftFilters.semester === "Fall")}
              >
                Fall
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraftFilters((prev) => {
                    const nextSemester = prev.semester === "Spring" ? "" : "Spring";
                    let nextLevel = prev.level;
                    if (nextSemester) {
                      nextLevel = adjustLevelForSemester(prev.level, prev.degree, nextSemester);
                    }
                    const next = { ...prev, semester: nextSemester, level: nextLevel };
                    setAppliedFilters((applied) => ({ ...applied, semester: nextSemester, level: nextLevel }));
                    return next;
                  });
                }}
                style={chipButtonStyle(draftFilters.semester === "Spring")}
              >
                Spring
              </button>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "1rem" }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, color: THEME_VARS.textMuted }}>Min credits</label>
              <input
                type="number"
                placeholder="Min"
                value={draftFilters.creditsMin}
                onChange={(e) => {
                  const { value } = e.target;
                  setDraftFilters((prev) => ({ ...prev, creditsMin: value }));
                  setAppliedFilters((prev) => ({ ...prev, creditsMin: value }));
                }}
                style={{ width: '100%' }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, color: THEME_VARS.textMuted }}>Max credits</label>
              <input
                type="number"
                placeholder="Max"
                value={draftFilters.creditsMax}
                onChange={(e) => {
                  const { value } = e.target;
                  setDraftFilters((prev) => ({ ...prev, creditsMax: value }));
                  setAppliedFilters((prev) => ({ ...prev, creditsMax: value }));
                }}
                style={{ width: '100%' }}
              />
            </div>
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            {MIN_SCORE_SLIDERS.map(({ key, label }) => {
              const levelIndex = getScoreStepIndex(draftFilters[key]);
              return (
                <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span>{label} minimum</span>
                    <span style={{ color: THEME_VARS.textMuted }}>
                      ≥ {formatScoreLevelLabel(draftFilters[key])}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={SCORE_STEP_VALUES.length - 1}
                    step={1}
                    value={levelIndex}
                    onChange={(e) => {
                      const idx = Number(e.target.value);
                      const snapped = SCORE_STEP_VALUES[idx] ?? SCORE_STEP_VALUES[0];
                      setDraftFilters((prev) => ({ ...prev, [key]: snapped }));
                      setAppliedFilters((prev) => ({ ...prev, [key]: snapped }));
                    }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: THEME_VARS.textMuted }}>
                    {SCORE_STEP_VALUES.map((_, idx) => (
                      <span key={idx} style={{ flex: 1, textAlign: idx === 0 ? 'left' : idx === SCORE_STEP_VALUES.length - 1 ? 'right' : 'center' }}>
                        {idx + 1}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        </div>
      </aside>

      {/* Main Content */}
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0 }}>Courses</h2>
          {!showFilters && (
            <button onClick={() => setShowFilters(true)}>Show filters</button>
          )}
        </div>
        {error && (
          <div
            style={{
              margin: '8px 0',
              padding: '8px 12px',
              background: THEME_VARS.dangerBg,
              border: `1px solid ${THEME_VARS.danger}`,
              borderRadius: 6,
              color: THEME_VARS.danger,
            }}
          >
            {error}
          </div>
        )}
        {loading && (
          <div style={{ margin: '8px 0', fontSize: 12, color: THEME_VARS.textMuted }}>Loading courses…</div>
        )}
        <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "8px 0", flexWrap: 'wrap' }}>
          {viewMode === 'list' ? (
            <>
              <span style={{ fontSize: 12, color: THEME_VARS.textMuted }}>Sort by</span>
              <div style={{ display: "flex", gap: 4, flexWrap: 'wrap' }}>
                <button
                  onClick={() => { setSortField("credits"); setSortOrder(sortField === "credits" && sortOrder === "asc" ? "desc" : "asc"); }}
                  style={chipButtonStyle(sortField === "credits")}
                  title="Toggle credits ascending/descending"
                >
                  Credits {sortField === "credits" ? (sortOrder === "asc" ? "↑" : "↓") : ""}
                </button>
                <button
                  onClick={() => { setSortField("workload"); setSortOrder(sortField === "workload" && sortOrder === "asc" ? "desc" : "asc"); }}
                  style={chipButtonStyle(sortField === "workload")}
                  title="Toggle workload ascending/descending"
                >
                  Workload {sortField === "workload" ? (sortOrder === "asc" ? "↑" : "↓") : ""}
                </button>
                {[
                  { key: 'score_relevance', label: 'Relevance score' },
                  { key: 'score_skills', label: 'Skills score' },
                  { key: 'score_product', label: 'Product score' },
                  { key: 'score_venture', label: 'Venture score' },
                  { key: 'score_foundations', label: 'Foundations score' },
                ].map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => {
                      setSortField(key);
                      setSortOrder(sortField === key ? (sortOrder === "desc" ? "asc" : "desc") : "desc");
                    }}
                    style={chipButtonStyle(sortField === key)}
                    title={`Toggle ${label} ascending/descending`}
                  >
                    {label} {sortField === key ? (sortOrder === "asc" ? "↑" : "↓") : ""}
                  </button>
                ))}
                <button
                  onClick={() => { setSortField(""); setSortOrder("asc"); }}
                  style={chipButtonStyle(false)}
                >
                  Clear sort
                </button>
              </div>
            </>
          ) : (
            <>
              <span style={{ fontSize: 12, color: THEME_VARS.textMuted }}>Pareto sort</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={() => setParetoPref(p => ({ ...p, credits: p.credits === 'max' ? 'min' : 'max' }))}
                  style={chipButtonStyle(paretoPref.credits === 'max')}
                  title="Toggle credits preference (max/min)"
                >
                  Credits {paretoPref.credits === 'max' ? '↓' : '↑'}
                </button>
                <button
                  onClick={() => setParetoPref(p => ({ ...p, workload: p.workload === 'min' ? 'max' : 'min' }))}
                  style={chipButtonStyle(paretoPref.workload === 'min')}
                  title="Toggle workload preference (min/max)"
                >
                  Workload {paretoPref.workload === 'min' ? '↑' : '↓'}
                </button>
                <button
                  onClick={() => setParetoPref({ credits: 'max', workload: 'min' })}
                  style={chipButtonStyle(false)}
                  title="Reset to default (credits max, workload min)"
                >
                  Default
                </button>
              </div>
            </>
          )}

          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: THEME_VARS.textMuted }}>View</span>
            <button
              onClick={() => setViewMode('list')}
              style={chipButtonStyle(viewMode === 'list')}
              title="List view"
            >
              List
            </button>
            <button
              onClick={() => setViewMode('grid')}
              style={chipButtonStyle(viewMode === 'grid')}
              title="Grid view"
            >
              Grid
            </button>
          </div>
        </div>
        {(() => {
          const totalPages = Math.max(1, Math.ceil(totalResults / pageSize));
          const shown = courses.length;
          return (
            <p style={{ marginTop: 4, color: THEME_VARS.textMuted }}>
              Showing {shown} of {totalResults} results · Page {page} / {totalPages}
            </p>
          );
        })()}

        {viewMode === 'list' ? (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gridTemplateColumns: '1fr', gap: '12px' }}>
            {courses.map((c, idx) => {
              const courseKey = courseKeyOf(c, idx);
              const scheduleLines = splitScheduleLines(c.schedule);
              const courseUrl = c.course_url || c.url || '';
              return (
                <li key={courseKey}>
                  <article
                    style={{
                      border: `1px solid ${THEME_VARS.border}`,
                      borderRadius: 8,
                      padding: '12px',
                      boxShadow: 'var(--shadow-elevation)',
                      background: THEME_VARS.surface,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                  <h3 style={{ margin: 0 }}>
                    <a
                      href={courseUrl || '#'}
                      target={courseUrl ? '_blank' : '_self'}
                      rel={courseUrl ? 'noreferrer' : undefined}
                      style={{
                        color: 'inherit',
                        textDecoration: 'none',
                        pointerEvents: courseUrl ? 'auto' : 'none',
                        fontWeight: 600,
                      }}
                    >
                      {c.course_name}
                    </a>
                    {c.course_code && (
                      <small style={{ marginLeft: 8 }}>({c.course_code})</small>
                    )}
                  </h3>
                  {renderProgramTags(c.available_programs)}
                  {renderLevelTags(c.available_levels)}
                  <ul style={{ listStyle: 'none', paddingLeft: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {buildCourseDetailRows(c, scheduleLines)}
                  </ul>
                  <ScoreSummary
                    course={c}
                    layout="list"
                    submissionState={submissionStates[courseKey]}
                    onSubmissionStateChange={(state) => updateSubmissionState(courseKey, state)}
                    savedValues={ratingValues[courseKey]}
                    onValuesChange={(vals) => updateRatingValues(courseKey, vals)}
                  />
                </article>
                </li>
              );
            })}
          </ul>
        ) : (
          (() => {
            // Build annotated list with metrics
            const annotated = courses.map((c, idx) => ({
              c,
              idx,
              credits: creditsOf(c),
              workload: workloadOf(c),
            }));
            const ranks = computeParetoRanks(annotated, paretoPref);
            const maxRank = ranks.reduce((m, r) => (r !== Infinity && r > m ? r : m), 0);
            const arranged = annotated
              .map((x, i) => ({ ...x, rank: ranks[i] }))
              .sort((a, b) => {
                const ra = a.rank === Infinity ? Number.MAX_SAFE_INTEGER : a.rank;
                const rb = b.rank === Infinity ? Number.MAX_SAFE_INTEGER : b.rank;
                if (ra !== rb) return ra - rb; // lower rank first
                // within same rank: order by current preferences
                if (a.credits !== b.credits) {
                  return paretoPref.credits === 'max' ? (b.credits - a.credits) : (a.credits - b.credits);
                }
                if (a.workload !== b.workload) {
                  return paretoPref.workload === 'min' ? (a.workload - b.workload) : (b.workload - a.workload);
                }
                return 0;
              });

            return (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(auto-fill, minmax(${GRID_MIN_WIDTH}px, 1fr))`,
                  gap: '12px'
                }}
              >
                {arranged.map(({ c, rank, idx }) => {
                  const courseKey = courseKeyOf(c, idx);
                  const scheduleLines = splitScheduleLines(c.schedule);
                  const courseUrl = c.course_url || c.url || '';
                  const t = maxRank <= 0 || rank === Infinity ? 1 : rank / maxRank; // 0..1, worst close to 1
                  const minL = 25, maxL = 90;
                  const lightness = Math.round(minL + t * (maxL - minL));
                  const bg = colorForRank(rank === Infinity ? maxRank : rank, maxRank);
                  const fg = textColorForBgHslLightness(lightness);
                  return (
                    <article
                      key={courseKey}
                      style={{
                        border: '1px solid rgba(0,0,0,0.08)',
                        borderRadius: 8,
                        padding: '12px',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                        background: bg,
                        color: fg,
                        display: 'flex',
                        flexDirection: 'column',
                        minHeight: 120
                      }}
                    >
                      <h3 style={{ margin: 0, fontSize: 16, lineHeight: '20px' }}>
                        <a
                          href={courseUrl || '#'}
                          target={courseUrl ? '_blank' : '_self'}
                          rel={courseUrl ? 'noreferrer' : undefined}
                          style={{
                            color: 'inherit',
                            textDecoration: 'none',
                            pointerEvents: courseUrl ? 'auto' : 'none',
                            fontWeight: 600,
                          }}
                        >
                          {c.course_name}
                        </a>
                      </h3>
                      {c.course_code && (
                        <div style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }}>{c.course_code}</div>
                      )}
                    {renderProgramTags(c.available_programs)}
                    {renderLevelTags(c.available_levels)}
                      <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0', display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {buildCourseDetailRows(c, scheduleLines)}
                      </ul>
                      <ScoreSummary
                        course={c}
                        layout="grid"
                        theme={fg === '#fff' ? 'dark' : 'light'}
                        submissionState={submissionStates[courseKey]}
                        onSubmissionStateChange={(state) => updateSubmissionState(courseKey, state)}
                        savedValues={ratingValues[courseKey]}
                        onValuesChange={(vals) => updateRatingValues(courseKey, vals)}
                      />
                    </article>
                  );
                })}
              </div>
            );
          })()
        )}

        <div style={{ marginTop: "1rem" }}>
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            style={{ marginRight: "1rem" }}
          >
            Previous
          </button>
          <span>Page {page}</span>
          {(() => {
            const totalPages = Math.max(1, Math.ceil(totalResults / pageSize));
            return (
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= totalPages}
                style={{ marginLeft: "1rem" }}
              >
                Next
              </button>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

export default CoursesList;
