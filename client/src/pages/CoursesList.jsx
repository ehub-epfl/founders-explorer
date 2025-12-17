// src/pages/CoursesList.jsx
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getCourses, getPeopleProfilesByCardUrls, getStudyPlansByProgram } from "../api/courses_api";
import submitCourseRating from "../api/submit_rating";
import { inferSemesterFromLevel } from "../utils/levels";
import { useAuth } from "../context/AuthContext.jsx";
import "./CoursesList.css";
import ForceGraph2D from "react-force-graph-2d";
import * as d3Force from "d3-force";

const GRID_MIN_WIDTH = 220; // px

const SCORE_FIELDS = [
  { key: 'score_relevance', label: 'Entrepreneurship Relevance' },
  { key: 'score_skills', label: 'Personal Development' },
  { key: 'score_product', label: 'Product Innovation' },
  { key: 'score_venture', label: 'Venture Ops' },
  { key: 'score_foundations', label: 'Startup Basics' },
];

// For multi-key sorting in list view
const SCORE_SORT_KEYS = ['score_relevance','score_skills','score_product','score_venture','score_foundations'];

// Helpers to build multi-key priorities and encode them for the API
function buildSortPriorities(sortField, sortOrder) {
  const isScoreField = SCORE_SORT_KEYS.includes(sortField);
  if (!sortField) {
    return SCORE_SORT_KEYS.map((f) => ({ field: f, order: 'desc' }));
  }
  if (sortField === 'credits' || sortField === 'workload') {
    return [{ field: sortField, order: sortOrder === 'asc' ? 'asc' : 'desc' }]
      .concat(SCORE_SORT_KEYS.map((f) => ({ field: f, order: 'desc' })));
  }
  if (isScoreField) {
    const rest = SCORE_SORT_KEYS.filter((f) => f !== sortField);
    return [{ field: sortField, order: sortOrder === 'asc' ? 'asc' : 'desc' }]
      .concat(rest.map((f) => ({ field: f, order: 'desc' })));
  }
  return SCORE_SORT_KEYS.map((f) => ({ field: f, order: 'desc' }));
}

function encodeSortKeys(priorities) {
  // Encode as a compact, backend-friendly string, e.g. "credits:asc,score_relevance:desc,..."
  if (!Array.isArray(priorities)) return '';
  return priorities
    .map((p) => `${p.field}:${p.order === 'asc' ? 'asc' : 'desc'}`)
    .join(',');
}

const SCORE_STEP_VALUES = Object.freeze([0, 25, 50, 75, 100]);
const SCORE_STEP_SIZE = SCORE_STEP_VALUES.length > 1 ? SCORE_STEP_VALUES[1] - SCORE_STEP_VALUES[0] : 1;

const MIN_SCORE_SLIDERS = [
  { key: 'minRelevance', label: 'Entrepreneurship Relevance' },
  { key: 'minSkills', label: 'Personal Development' },
  { key: 'minProduct', label: 'Product Innovation' },
  { key: 'minVenture', label: 'Venture Ops' },
  { key: 'minFoundations', label: 'Startup Basics' },
];

const TAG_COLORS = [
  '#56423D',
  '#BEA6A0',
  '#916361',
  '#4A271E',
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

const PARETO_RANK_COLORS = Object.freeze([
  '#5E0002', // top Pareto front
  '#BE0D10',
  '#FF9799', // fallback for lower tiers
]);

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

const SCORE_LABELS_FULL = Object.freeze({
  relevance: 'Entrepreneurship Relevance',
  skills: 'Personal Development',
  product: 'Product Innovation',
  venture: 'Venture Ops',
  foundations: 'Startup Basics',
});

const SCORE_LABELS_ABBR = Object.freeze({
  relevance: 'ER',
  skills: 'PD',
  product: 'PI',
  venture: 'VO',
  foundations: 'SB',
});

const SCORE_COLORS = Object.freeze({
  relevance: '#FF006F',
  skills: '#FFBCD9',
  product: '#6D4B9A',
  venture: '#4A62FF',
  foundations: '#5AB7D4',
});

const SCORE_LEGEND_ITEMS = [
  { key: 'relevance', label: SCORE_LABELS_FULL.relevance, color: SCORE_COLORS.relevance },
  { key: 'skills', label: SCORE_LABELS_FULL.skills, color: SCORE_COLORS.skills },
  { key: 'product', label: SCORE_LABELS_FULL.product, color: SCORE_COLORS.product },
  { key: 'venture', label: SCORE_LABELS_FULL.venture, color: SCORE_COLORS.venture },
  { key: 'foundations', label: SCORE_LABELS_FULL.foundations, color: SCORE_COLORS.foundations },
];

function generateRandomResultsNoise(length = 4) {
  let result = '';
  for (let i = 0; i < length; i += 1) {
    result += Math.floor(Math.random() * 10);
  }
  return result;
}

function ScoreLegendRow({ resultsDisplay }) {
  const size = 80;
  const radius = 23;
  const arcRadius = 30;
  const center = size / 2;

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: 16,
        marginBottom: 8,
        flexWrap: 'wrap',
        gap: 16,
      }}
    >
      <div
        style={{
          minWidth: 0,
          flex: '1 1 200px',
          display: 'flex',
          justifyContent: 'flex-start',
        }}
      >
        <div
          style={{
            fontFamily: '"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            fontStyle: 'normal',
            fontWeight: 700,
            fontSize: 40,
            lineHeight: '120%',
            letterSpacing: '0.08em',
            color: '#000000',
            textAlign: 'left',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {resultsDisplay}
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        {SCORE_LEGEND_ITEMS.map((item, index) => (
          <svg
            key={item.key}
            width={size}
            height={size}
            viewBox={`0 0 ${size} ${size}`}
          >
            <defs>
              <path
                id={`score-legend-arc-${index}`}
                d={`
                M ${center - arcRadius}, ${center}
                A ${arcRadius} ${arcRadius} 0 0 1 ${center + arcRadius} ${center}
              `}
              />
            </defs>
            <circle
              cx={center}
              cy={center}
              r={radius}
              fill={item.color}
              opacity={0.9}
            />
            <text
              fill="#000000"
              fontSize="6"
              fontFamily='"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
            >
              <textPath
                href={`#score-legend-arc-${index}`}
                startOffset="50%"
                textAnchor="middle"
              >
                {item.label.toUpperCase()}
              </textPath>
            </text>
          </svg>
        ))}
      </div>
    </div>
  );
}

const capsuleInputStyle = (disabled = false) => ({
  width: '100%',
  padding: '6px 16px',
  borderRadius: 999,
  border: `1px solid ${disabled ? THEME_VARS.borderSubtle : '#000000'}`,
  background: disabled ? THEME_VARS.disabledBg : '#FFFFFF',
  color: disabled ? THEME_VARS.disabledText : '#000000',
  fontFamily: '"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  fontWeight: 300,
  fontSize: 14,
  lineHeight: '145%',
  letterSpacing: '-0.005em',
  outlineColor: '#000000',
  caretColor: '#000000',
});

const selectFieldStyle = (disabled = false) => ({
  ...capsuleInputStyle(false),
  color: disabled ? '#9CA3AF' : '#000000',
  borderColor: '#000000',
  opacity: disabled ? 0.65 : 1,
  cursor: disabled ? 'not-allowed' : 'pointer',
  appearance: 'none',
  WebkitAppearance: 'none',
  backgroundImage: 'linear-gradient(45deg, transparent 50%, #000 50%), linear-gradient(135deg, #000 50%, transparent 50%)',
  backgroundPosition: 'calc(100% - 18px) calc(50% - 2px), calc(100% - 12px) calc(50% - 2px)',
  backgroundSize: '6px 6px, 6px 6px',
  backgroundRepeat: 'no-repeat',
  paddingRight: 36,
});

const chipButtonStyle = (active = false) => ({
  boxSizing: 'border-box',
  height: 20,
  padding: '0 6px',
  borderRadius: 50,
  background: active ? '#000000' : '#FFFFFF',
  border: '1px solid #000000',
  fontFamily: '"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  fontStyle: 'normal',
  fontWeight: 300,
  fontSize: 13,
  lineHeight: '145%',
  letterSpacing: '-0.005em',
  color: active ? '#FFFFFF' : '#000000',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  transition: 'background 0.2s ease, color 0.2s ease, border-color 0.2s ease',
});

const filterCapsuleButtonStyle = ({ active = false, variant = 'outline', disabled = false } = {}) => {
  let background = '#FFFFFF';
  let color = '#000000';
  let borderColor = '#000000';

  if (variant === 'solid' || active) {
    background = '#000000';
    color = '#FFFFFF';
    borderColor = '#000000';
  } else if (variant === 'ghost') {
    background = 'transparent';
    color = '#000000';
    borderColor = 'rgba(0, 0, 0, 0.35)';
  }

  if (disabled) {
    background = '#F3F4F6';
    color = '#9CA3AF';
    borderColor = '#E5E7EB';
  }

  return {
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 18px',
    minHeight: 32,
    borderRadius: 999,
    border: `1px solid ${borderColor}`,
    background,
    color,
    fontFamily: '"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontStyle: 'normal',
    fontWeight: 300,
    fontSize: 14,
    lineHeight: '145%',
    letterSpacing: '-0.005em',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.7 : 1,
    transition: 'background 0.2s ease, color 0.2s ease, border-color 0.2s ease',
    outlineColor: '#000000',
  };
};

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

const fieldLabelStyle = {
  fontSize: 11,
  marginBottom: 4,
  color: THEME_VARS.textMuted,
  textTransform: 'lowercase',
  fontStyle: 'italic',
};
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
    course?.course_key ??
    course?.id ??
    course?.course_code ??
    course?.url ??
    (course?.course_name ? `name:${course.course_name}` : null) ??
    `course-${fallbackIndex}`
  );
}

function normalizeFocusKey(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
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
  let nearest = SCORE_STEP_VALUES[0];
  let minDiff = Math.abs(clamped - nearest);
  for (const option of SCORE_STEP_VALUES) {
    const diff = Math.abs(clamped - option);
    if (diff < minDiff) {
      nearest = option;
      minDiff = diff;
    }
  }
  return nearest;
}

function getScoreStepIndex(value) {
  const snapped = snapToScoreStep(value);
  const index = SCORE_STEP_VALUES.findIndex((option) => option === snapped);
  return index >= 0 ? index : 0;
}

function formatScoreLevelLabel(value) {
  const snapped = snapToScoreStep(value);
  return `${snapped}`;
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
              color: '#FFFFFF',
              padding: '0 12px',
              height: 20,
              borderRadius: 50,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: '"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
              fontStyle: 'normal',
              fontWeight: 300,
              fontSize: 13,
              lineHeight: '145%',
              letterSpacing: '-0.005em',
            }}
          >
            {name}
          </span>
        );
      })}
    </div>
  );
}

function renderProgramTags(programs, studyPlanTags = []) {
  if (!Array.isArray(programs) || programs.length === 0) return null;

  const normalizeProgramName = (entry) => {
    if (!entry) return '';
    if (typeof entry === 'string') return entry.trim();
    if (typeof entry === 'object') {
      if (typeof entry.program_name === 'string') return entry.program_name.trim();
      if (typeof entry.name === 'string') return entry.name.trim();
    }
    return '';
  };

  const exclusion = new Set(
    (Array.isArray(studyPlanTags) ? studyPlanTags : [])
      .map((value) => {
        if (typeof value === 'string') return value.trim().toLowerCase();
        if (value && typeof value === 'object') {
          if (typeof value.study_faculty === 'string') return value.study_faculty.trim().toLowerCase();
          if (typeof value.faculty === 'string') return value.faculty.trim().toLowerCase();
        }
        return '';
      })
      .filter(Boolean),
  );

  const uniquePrograms = Array.from(
    new Set(
      programs
        .map((entry) => normalizeProgramName(entry))
        .filter((name) => {
          if (!name) return false;
          const normalized = name.toLowerCase();
          return !exclusion.has(normalized);
        }),
    ),
  );

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
              color: '#FFFFFF',
              padding: '0 12px',
              height: 20,
              borderRadius: 50,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: '"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
              fontStyle: 'normal',
              fontWeight: 300,
              fontSize: 13,
              lineHeight: '145%',
              letterSpacing: '-0.005em',
            }}
          >
            {name}
          </span>
        );
      })}
    </div>
  );
}

function renderStudyPlanTags(course) {
  if (!course) return null;
  const tags = Array.isArray(course.study_plan_tags)
    ? course.study_plan_tags.map((label) => (typeof label === 'string' ? label.trim() : '')).filter(Boolean)
    : [];
  if (!tags.length) {
    const fallbackFaculty = typeof course.study_faculty === 'string' ? course.study_faculty.trim() : '';
    if (fallbackFaculty) {
      tags.push(fallbackFaculty);
    }
  }
  if (!tags.length) return null;
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {tags.map((tag) => {
          const color = colorForTag(tag);
          return (
            <span
              key={tag}
              style={{
                background: color,
                color: '#FFFFFF',
                padding: '0 12px',
                height: 20,
                borderRadius: 50,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: '"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                fontStyle: 'normal',
                fontWeight: 300,
                fontSize: 13,
                lineHeight: '145%',
                letterSpacing: '-0.005em',
                whiteSpace: 'nowrap',
              }}
            >
              {tag}
            </span>
          );
        })}
      </div>
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

function formatWorkloadDisplay(value) {
  if (value == null) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  if (/semester/i.test(raw)) {
    return raw;
  }
  const numeric = parseNumberLike(raw);
  if (Number.isFinite(numeric)) {
    const text = `${numeric}`.replace(/\.0$/, '');
    return `${text} hour(s)/week`;
  }
  if (/\bhour/i.test(raw) && /\bweek/i.test(raw)) {
    return raw;
  }
  return `${raw} hour(s)/week`;
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
      <a
        href={teacher.url}
        target="_blank"
        rel="noreferrer"
        style={{ color: '#000000', textDecoration: 'none' }}
      >
        {teacher.name}
      </a>
    ) : (
      <span style={{ color: '#000000' }}>{teacher.name}</span>
    );
    return (
      <span key={`${teacher.name}-${teacher.url || index}`} style={{ color: '#000000' }}>
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

const DAY_DEFINITIONS = Object.freeze([
  { index: 0, label: 'Mon', fullLabel: 'Monday', names: ['monday', 'mon', 'lundi', 'lun'] },
  { index: 1, label: 'Tue', fullLabel: 'Tuesday', names: ['tuesday', 'tue', 'mardi', 'mar'] },
  { index: 2, label: 'Wed', fullLabel: 'Wednesday', names: ['wednesday', 'wed', 'mercredi', 'mer'] },
  { index: 3, label: 'Thu', fullLabel: 'Thursday', names: ['thursday', 'thu', 'jeudi', 'jeu'] },
  { index: 4, label: 'Fri', fullLabel: 'Friday', names: ['friday', 'fri', 'vendredi', 'ven'] },
  { index: 5, label: 'Sat', fullLabel: 'Saturday', names: ['saturday', 'sat', 'samedi', 'sam'] },
  { index: 6, label: 'Sun', fullLabel: 'Sunday', names: ['sunday', 'sun', 'dimanche', 'dim'] },
]);

const AVAILABILITY_GRID_START = 8 * 60; // 08:00
const AVAILABILITY_GRID_END = 20 * 60; // 20:00
const AVAILABILITY_GRID_STEP = 60; // minutes

const AVAILABILITY_SLOT_MINUTES = (() => {
  const slots = [];
  for (let minute = AVAILABILITY_GRID_START; minute < AVAILABILITY_GRID_END; minute += AVAILABILITY_GRID_STEP) {
    slots.push(minute);
  }
  return slots;
})();

const AVAILABILITY_SELECTED_BG = 'rgba(248, 113, 113, 0.3)';

function buildAvailabilitySlotId(dayIndex, minuteStart) {
  return `${dayIndex}-${minuteStart}`;
}

function parseAvailabilitySlotId(slotId) {
  if (typeof slotId !== 'string' || !slotId.includes('-')) return null;
  const [dayRaw, minuteRaw] = slotId.split('-');
  const dayIndex = Number(dayRaw);
  const minuteStart = Number(minuteRaw);
  if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex >= DAY_DEFINITIONS.length) return null;
  if (!Number.isInteger(minuteStart)) return null;
  const offset = minuteStart - AVAILABILITY_GRID_START;
  if (offset < 0 || offset % AVAILABILITY_GRID_STEP !== 0) return null;
  const rowIndex = offset / AVAILABILITY_GRID_STEP;
  if (rowIndex < 0 || rowIndex >= AVAILABILITY_SLOT_MINUTES.length) return null;
  return { dayIndex, rowIndex };
}

function decodeAvailabilitySlots(serialized) {
  if (typeof serialized !== 'string' || !serialized.trim()) {
    return new Set();
  }
  return new Set(
    serialized
      .split(',')
      .map((token) => token.trim())
      .filter(Boolean),
  );
}

function encodeAvailabilitySlots(slots) {
  if (!(slots instanceof Set)) return '';
  return Array.from(slots)
    .sort((a, b) => {
      const [aDay, aMinute] = a.split('-').map(Number);
      const [bDay, bMinute] = b.split('-').map(Number);
      if (aDay !== bDay) return aDay - bDay;
      return aMinute - bMinute;
    })
    .join(',');
}

function setAvailabilitySlotValue(serialized, slotId, shouldSelect) {
  if (!slotId) return serialized || '';
  const current = decodeAvailabilitySlots(serialized);
  const next = new Set(current);
  if (shouldSelect) {
    next.add(slotId);
  } else {
    next.delete(slotId);
  }
  return encodeAvailabilitySlots(next);
}

function toggleAvailabilitySlotValue(serialized, slotId) {
  if (!slotId) return serialized || '';
  const current = decodeAvailabilitySlots(serialized);
  const shouldSelect = !current.has(slotId);
  return setAvailabilitySlotValue(serialized, slotId, shouldSelect);
}

const DAY_INDEX_LOOKUP = DAY_DEFINITIONS.reduce((map, day) => {
  day.names.forEach((name) => {
    map.set(name.toLowerCase(), day.index);
  });
  return map;
}, new Map());

function parseDayToken(token) {
  if (!token) return null;
  const normalized = token.toLowerCase().replace(/[,.;:]/g, '').trim();
  return DAY_INDEX_LOOKUP.get(normalized) ?? null;
}

function parseTimeToken(token) {
  if (!token) return null;
  const normalized = token
    .toLowerCase()
    .replace(/h/g, ':')
    .replace(/\s+/g, '')
    .replace(/\u2013|\u2014/g, '-')
    .replace(/\.-/g, '-')
    .replace(/\.(\d{2})/g, ':$1');
  const [hoursPart, minutesPart] = normalized.split(':');
  const hours = Number.parseInt(hoursPart, 10);
  const minutes = minutesPart !== undefined ? Number.parseInt(minutesPart, 10) : 0;
  if (!Number.isFinite(hours) || hours < 0 || hours > 24) {
    return null;
  }
  if (!Number.isFinite(minutes) || minutes < 0 || minutes >= 60) {
    return null;
  }
  return hours * 60 + minutes;
}

function formatMinutesToLabel(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

const EVENT_COLORS = Object.freeze({
  lecture: '#FF0000',
  exercise: '#0082FF',
  lab: '#5AB7D4',
  other: '#4b5563',
});

const EVENT_BLOCK_HORIZONTAL_INSET = 1; // px margin inside the day column so hover area matches the fill

function categorizeEventLabel(label) {
  const text = (label || '').toLowerCase();
  if (!text) return 'other';
  if (text.includes('lecture') || text.includes('cours') || text.includes('class')) {
    return 'lecture';
  }
  if (text.includes('exercise') || text.includes('tp') || text.includes('tutorial') || text.includes('seminar')) {
    return 'exercise';
  }
  if (text.includes('lab') || text.includes('laboratory') || text.includes('workshop') || text.includes('project')) {
    return 'lab';
  }
  return 'other';
}

function buildScheduleEvents(scheduleLines) {
  if (!Array.isArray(scheduleLines) || scheduleLines.length === 0) {
    return [];
  }

  const events = [];
  const rangeRegex =
    /^(?<day>[A-Za-zÀ-ÿ]+)[,]?\s+(?<start>\d{1,2}(?::\d{2})?|\d{1,2}h\d{0,2})\s*[–—-]\s*(?<end>\d{1,2}(?::\d{2})?|\d{1,2}h\d{0,2})(?:\s*[:,-]\s*(?<label>.*))?$/u;

  for (const rawLine of scheduleLines) {
    const match = rangeRegex.exec(rawLine);
    if (!match) continue;
    const dayIndex = parseDayToken(match.groups?.day || '');
    if (dayIndex === null) continue;
    const startMinutes = parseTimeToken(match.groups?.start || '');
    const endMinutes = parseTimeToken(match.groups?.end || '');
    if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes)) continue;
    if (endMinutes <= startMinutes) continue;
    const rawLabel = (match.groups?.label || '').trim();
    const dayDefinition = DAY_DEFINITIONS.find((day) => day.index === dayIndex);
    const rawDayToken = (match.groups?.day || '').trim();
    let tooltipDayLabel = dayDefinition?.fullLabel || '';
    if (!tooltipDayLabel && rawDayToken) {
      tooltipDayLabel = `${rawDayToken.charAt(0).toUpperCase()}${rawDayToken.slice(1).toLowerCase()}`;
    }
    const tooltipTime = `${formatMinutesToLabel(startMinutes)}\u2013${formatMinutesToLabel(endMinutes)}`;
    const tooltip =
      `${tooltipDayLabel ? `${tooltipDayLabel} ` : ''}${tooltipTime}${rawLabel ? `: ${rawLabel}` : ''}`.trim();
    events.push({
      dayIndex,
      startMinutes,
      endMinutes,
      label: rawLabel,
      category: categorizeEventLabel(rawLabel),
      raw: rawLine,
      tooltip: tooltip || rawLine,
    });
  }

  return events.sort((a, b) => {
    if (a.dayIndex !== b.dayIndex) {
      return a.dayIndex - b.dayIndex;
    }
    return a.startMinutes - b.startMinutes;
  });
}

function WeekScheduleCalendar({ events }) {
  if (!Array.isArray(events) || events.length === 0) {
    return null;
  }

  const filtered = events.filter((event) => event.dayIndex >= 0 && event.dayIndex <= 4);
  if (!filtered.length) {
    return null;
  }

  const minStart = filtered.reduce((min, event) => Math.min(min, event.startMinutes), Infinity);
  const maxEnd = filtered.reduce((max, event) => Math.max(max, event.endMinutes), -Infinity);
  if (!Number.isFinite(minStart) || !Number.isFinite(maxEnd)) {
    return null;
  }

  const anchorStart = Math.min(minStart, 8 * 60);
  const anchorEnd = Math.max(maxEnd, 19 * 60);
  const totalMinutes = Math.max(anchorEnd - anchorStart, 60);
  const SCHEDULE_SIZE = 171; // square container
  const headerHeight = 20;
  const heightPx = SCHEDULE_SIZE - headerHeight - 16; // inner column height

  return (
    <div
      style={{
        width: SCHEDULE_SIZE,
        height: SCHEDULE_SIZE,
        borderRadius: 10,
        padding: 8,
        background: '#D9D9D9',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
          gap: 4,
          fontSize: 10,
          lineHeight: 1.2,
        }}
      >
        {DAY_DEFINITIONS.slice(0, 5).map((day, idx) => {
          const labelChar = ['M', 'T', 'W', 'T', 'F'][idx];
          const dayEvents = filtered.filter((event) => event.dayIndex === day.index);
          return (
            <div
              key={day.index}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <div
                style={{
                  textAlign: 'center',
                  fontWeight: 600,
                  color: '#000000',
                  letterSpacing: '0.3em',
                  height: headerHeight,
                  lineHeight: `${headerHeight}px`,
                }}
              >
                {labelChar}
              </div>
              <div
                style={{
                  position: 'relative',
                  height: heightPx,
                  borderRadius: 10,
                  background: '#D9D9D9',
                  overflow: 'hidden',
                }}
              >
        {dayEvents.map((event, idx2) => {
          const top = ((event.startMinutes - anchorStart) / totalMinutes) * 100;
          const height = ((event.endMinutes - event.startMinutes) / totalMinutes) * 100;
                  const fallbackDayLabel = day.fullLabel || day.label || '';
                  const fallbackTooltip = `${fallbackDayLabel ? `${fallbackDayLabel} ` : ''}${formatMinutesToLabel(event.startMinutes)}\u2013${formatMinutesToLabel(event.endMinutes)}${event.label ? `: ${event.label}` : ''}`;
                  const blockTitle = event.tooltip || event.raw || fallbackTooltip;
                  return (
                    <div
                      key={`${event.raw}-${idx2}`}
                      title={blockTitle}
                      style={{
                        position: 'absolute',
                        left: 4,
                        right: 4,
                        top: `${Math.max(0, top)}%`,
                        height: `${Math.max(8, height)}%`,
                        borderRadius: 50,
                        background: EVENT_COLORS[event.category] || EVENT_COLORS.other,
                        boxShadow: 'none',
                        cursor: 'default',
                        pointerEvents: 'auto',
                      }}
                />
              );
            })}
          </div>
        </div>
      );
    })}
      </div>
    </div>
  );
}

function AvailabilityGrid({ selectedSlots, onToggleSlot, onSetSlot, onClear }) {
  const activeSlots = selectedSlots instanceof Set ? selectedSlots : new Set();
  const [isDragging, setIsDragging] = useState(false);
  const dragModeRef = useRef(null); // 'add' | 'remove' | null
  const dragActiveRef = useRef(false);
  const lastSlotRef = useRef(null);

  useEffect(() => {
    function stopDrag() {
      if (!dragActiveRef.current) return;
      dragActiveRef.current = false;
      dragModeRef.current = null;
      lastSlotRef.current = null;
      setIsDragging(false);
    }
    window.addEventListener('pointerup', stopDrag);
    window.addEventListener('pointercancel', stopDrag);
    return () => {
      window.removeEventListener('pointerup', stopDrag);
      window.removeEventListener('pointercancel', stopDrag);
    };
  }, []);

  const applySlotState = useCallback(
    (slotId, shouldSelect, currentlyActive) => {
      if (!slotId) return;
      if (typeof onSetSlot === 'function') {
        onSetSlot(slotId, shouldSelect);
      } else if (typeof onToggleSlot === 'function') {
        if (shouldSelect !== currentlyActive) {
          onToggleSlot(slotId);
        }
      }
    },
    [onSetSlot, onToggleSlot],
  );

  const handleKeyToggle = (event, slotId) => {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      if (typeof onToggleSlot === 'function') {
        onToggleSlot(slotId);
      }
    }
  };

  const handlePointerDown = (event, slotId, currentlyActive) => {
    if (!slotId) return;
    event.preventDefault();
    const shouldSelect = !currentlyActive;
    dragModeRef.current = shouldSelect ? 'add' : 'remove';
    dragActiveRef.current = true;
    lastSlotRef.current = slotId;
    setIsDragging(true);
    applySlotState(slotId, shouldSelect, currentlyActive);
  };

  const handlePointerEnter = (slotId) => {
    if (!dragActiveRef.current || !slotId) return;
    if (lastSlotRef.current === slotId) return;
    const mode = dragModeRef.current;
    if (mode !== 'add' && mode !== 'remove') return;
    lastSlotRef.current = slotId;
    const currentlyActive = activeSlots.has(slotId);
    const shouldSelect = mode === 'add';
    applySlotState(slotId, shouldSelect, currentlyActive);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: THEME_VARS.text }}>
          Weekly availability
        </div>
        <button
          type="button"
          onClick={onClear}
          disabled={!activeSlots.size}
          style={{
            ...filterCapsuleButtonStyle({ variant: 'outline', disabled: !activeSlots.size }),
            padding: '0 12px',
            minHeight: 26,
            fontSize: 12,
          }}
        >
          Reset
        </button>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `56px repeat(${DAY_DEFINITIONS.length}, minmax(0, 1fr))`,
          columnGap: 0,
          rowGap: 0,
          fontSize: 10,
          color: THEME_VARS.textMuted,
          borderRadius: 6,
          overflow: 'hidden',
          border: `1px solid ${THEME_VARS.borderSubtle}`,
        }}
      >
        <div />
        {DAY_DEFINITIONS.map((day) => (
          <div
            key={`availability-header-${day.index}`}
            style={{ textAlign: 'center', fontWeight: 600 }}
          >
            {day.label}
          </div>
        ))}
        {AVAILABILITY_SLOT_MINUTES.map((minuteStart) => (
          <Fragment key={`availability-row-${minuteStart}`}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
                paddingRight: 2,
                fontSize: 9,
                color: THEME_VARS.textMuted,
              }}
            >
              {formatMinutesToLabel(minuteStart)}
            </div>
        {DAY_DEFINITIONS.map((day) => {
          const slotId = buildAvailabilitySlotId(day.index, minuteStart);
          const active = activeSlots.has(slotId);
              return (
                <button
                  key={slotId}
                  type="button"
                  onPointerDown={(event) => handlePointerDown(event, slotId, active)}
                  onPointerEnter={() => handlePointerEnter(slotId)}
                  onKeyDown={(event) => handleKeyToggle(event, slotId)}
                  title={`${day.fullLabel || day.label} ${formatMinutesToLabel(minuteStart)}–${formatMinutesToLabel(minuteStart + AVAILABILITY_GRID_STEP)}`}
                  style={{
                    width: '100%',
                    aspectRatio: '1 / 0.75',
                    borderRadius: 0,
                    border: 'none',
                    background: active ? AVAILABILITY_SELECTED_BG : 'rgba(148, 163, 184, 0.08)',
                    cursor: isDragging ? 'grabbing' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 0,
                    color: 'transparent',
                    transition: 'background 0.1s ease, border 0.1s ease',
                  }}
                  aria-pressed={active}
                >
                  {active ? '' : ''}
                </button>
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function eventConflictsWithSelectedAvailability(event, unavailableSlots) {
  if (!(unavailableSlots instanceof Set) || unavailableSlots.size === 0) return false;
  if (event.startMinutes < AVAILABILITY_GRID_START || event.endMinutes > AVAILABILITY_GRID_END) {
    return true;
  }
  for (const slotStart of AVAILABILITY_SLOT_MINUTES) {
    const slotEnd = slotStart + AVAILABILITY_GRID_STEP;
    if (slotEnd <= event.startMinutes) continue;
    if (slotStart >= event.endMinutes) break;
    const slotId = buildAvailabilitySlotId(event.dayIndex, slotStart);
    if (unavailableSlots.has(slotId)) {
      return true;
    }
  }
  return false;
}

function courseMatchesAvailability(course, unavailableSlots) {
  if (!(unavailableSlots instanceof Set) || unavailableSlots.size === 0) {
    return true;
  }

  const matrix = Array.isArray(course?.schedule_matrix) ? course.schedule_matrix : null;
  const matrixHasShape =
    Array.isArray(matrix) &&
    matrix.length === AVAILABILITY_SLOT_MINUTES.length &&
    matrix.every((row) => Array.isArray(row) && row.length === DAY_DEFINITIONS.length);

  if (matrixHasShape) {
    for (const slotId of unavailableSlots) {
      const parsed = parseAvailabilitySlotId(slotId);
      if (!parsed) return false;
      const { dayIndex, rowIndex } = parsed;
      if (Number(matrix[rowIndex]?.[dayIndex])) return false;
    }
    return true;
  }

  // Fallback to parsed schedule lines if no matrix is available.
  const scheduleLines = splitScheduleLines(course?.schedule);
  const events = buildScheduleEvents(scheduleLines);
  if (!events.length) {
    // If the course has no schedule information, include by default.
    return true;
  }
  return events.every((event) => !eventConflictsWithSelectedAvailability(event, unavailableSlots));
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

  const workloadDisplay = formatWorkloadDisplay(course.workload);
  if (workloadDisplay) {
    rows.push(renderIconRow('workload.svg', 'Workload', workloadDisplay, 'workload'));
  }

  if (course.type) {
    rows.push(renderIconRow('type.svg', 'Type', course.type, 'type'));
  }

  if (course.semester) {
    rows.push(renderIconRow('semester.svg', 'Semester', course.semester, 'semester'));
  }

  if (course.exam_form) {
    rows.push(renderPlainRow('Exam', course.exam_form, 'exam'));
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
  study_program: "",
  study_plan: "",
  availabilitySlots: "",
});

const FILTER_KEYS = Object.keys(createDefaultFilters());

function parseFiltersFromSearch(search) {
  const base = createDefaultFilters();
  if (!search) return base;
  const sp = new URLSearchParams(search);
  base.study_program = sp.get('study_program') || '';
  base.study_plan = sp.get('study_plan') || '';
  base.type = sp.get('type') || '';
  base.semester = sp.get('semester') || '';
  if (base.study_plan && !base.semester) {
    base.semester = inferSemesterFromLevel(base.study_plan) || '';
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
  base.availabilitySlots = sp.get('freeSlots') || '';
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

function getStudyPlanOptions(tree, studyProgram) {
  if (!tree || !studyProgram || !tree[studyProgram]) return [];
  const bucket = tree[studyProgram];
  if (Array.isArray(bucket)) {
    return bucket
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }
  if (bucket && typeof bucket === 'object') {
    return Object.keys(bucket)
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }
  return [];
}

function withValueOption(options, value) {
  if (!value) return options;
  if (options.includes(value)) return options;
  return [...options, value];
}

function normalizeScore(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (num < SCORE_STEP_VALUES[0]) return SCORE_STEP_VALUES[0];
  if (num > SCORE_STEP_VALUES[SCORE_STEP_VALUES.length - 1]) return SCORE_STEP_VALUES[SCORE_STEP_VALUES.length - 1];
  return Math.round(num);
}

function formatScoreDisplay(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '–';
  return `${Math.round(num)}`;
}

function ScoreSummary({
  course,
  theme = 'light',
  layout = 'list',
  submissionState,
  onSubmissionStateChange,
  savedValues,
  onValuesChange,
  onOpenGraph,
}) {
  const { user, isGuest } = useAuth();
  const userEmail = typeof user?.email === 'string' ? user.email.trim() : '';
  const base = {
    relevance: normalizeScore(course?.score_relevance),
    skills: normalizeScore(course?.score_skills),
    product: normalizeScore(course?.score_product),
    venture: normalizeScore(course?.score_venture),
  foundations: normalizeScore(course?.score_foundations),
};
  const rawCourseDescription = typeof course?.description === 'string' ? course.description.trim() : '';
  const courseNameForPrefix = typeof course?.course_name === 'string' ? course.course_name.trim() : '';
  let courseDescription = rawCourseDescription;
  if (courseNameForPrefix && courseDescription) {
    const trimmedDesc = courseDescription.trim();
    const lowerDesc = trimmedDesc.toLowerCase();
    const lowerName = courseNameForPrefix.toLowerCase();

    // If it already starts with the course name, keep as-is.
    if (!lowerDesc.startsWith(lowerName)) {
      // Replace leading "This/The ... course" with the course name:
      // e.g. "This course explores..." -> "Social Innovation Lab explores..."
      const replacedCoursePhrase = trimmedDesc.replace(
        /^((this|the)\s+[^.]*?\bcourse)\b/i,
        courseNameForPrefix
      );

      if (replacedCoursePhrase !== trimmedDesc) {
        courseDescription = replacedCoursePhrase;
      } else {
        // Replace leading pronouns "It/This ..." with the course name.
        const replacedPronoun = trimmedDesc.replace(
          /^(it|this)\s+/i,
          `${courseNameForPrefix} `
        );
        courseDescription = replacedPronoun;
      }
    } else {
      courseDescription = trimmedDesc;
    }
  }

  const SCORE_FALLBACK = SCORE_STEP_VALUES[0] ?? 0;

  const snapValueOrDefault = (value) => {
    const numeric = Number(value);
    return snapToScoreStep(Number.isFinite(numeric) ? numeric : SCORE_FALLBACK);
  };

  const withSnappedValues = (candidate) => ({
    relevance: snapValueOrDefault(candidate?.relevance),
    skills: snapValueOrDefault(candidate?.skills),
    product: snapValueOrDefault(candidate?.product),
    venture: snapValueOrDefault(candidate?.venture),
    foundations: snapValueOrDefault(candidate?.foundations),
  });

  const defaultValues = useMemo(() => ({
    relevance: SCORE_STEP_VALUES[0],
    skills: SCORE_STEP_VALUES[0],
    product: SCORE_STEP_VALUES[0],
    venture: SCORE_STEP_VALUES[0],
    foundations: SCORE_STEP_VALUES[0],
  }), []);

  const createEmptyComments = useCallback(() => ({
    relevance: '',
    skills: '',
    product: '',
    venture: '',
    foundations: '',
  }), []);

  const pendingValuesRef = useRef(null);
  const [values, setValues] = useState(withSnappedValues(savedValues ?? defaultValues));
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(Boolean(submissionState?.submitted));
  const [submitError, setSubmitError] = useState('');
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [commentNotes, setCommentNotes] = useState(createEmptyComments);
  const [showCourseDetailModal, setShowCourseDetailModal] = useState(false);

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
    setCommentNotes(createEmptyComments());
    setShowRatingModal(false);
  }, [course?.id, course?.course_code, defaultValues, createEmptyComments]);

  // Keep values in sync if external savedValues change, without closing the modal
  useEffect(() => {
    const nextValues = withSnappedValues(savedValues ?? defaultValues);
    setValues(nextValues);
  }, [savedValues, defaultValues]);

  useEffect(() => {
    setShowCourseDetailModal(false);
  }, [course?.id, course?.course_code]);

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

  const labelMap = layout === 'grid' ? SCORE_LABELS_ABBR : SCORE_LABELS_FULL;
  const rows = [
    { key: 'relevance', label: labelMap.relevance, color: SCORE_COLORS.relevance, base: base.relevance },
    { key: 'skills', label: labelMap.skills, color: SCORE_COLORS.skills, base: base.skills },
    { key: 'product', label: labelMap.product, color: SCORE_COLORS.product, base: base.product },
    { key: 'venture', label: labelMap.venture, color: SCORE_COLORS.venture, base: base.venture },
    { key: 'foundations', label: labelMap.foundations, color: SCORE_COLORS.foundations, base: base.foundations },
  ];

  const ratingGuidance = {
    relevance: 'Relevance to entrepreneurship/innovation.',
    skills: 'Personal growth and transferable skills.',
    product: 'Product thinking and building execution.',
    venture: 'Venture operations and business rigor.',
    foundations: 'Foundational knowledge and basics.',
  };

  const handleCommentChange = (key, text) => {
    setCommentNotes((prev) => ({ ...prev, [key]: text }));
  };

  const isDark = theme === 'dark';
  const labelColor = isDark ? 'rgba(255,255,255,0.85)' : THEME_VARS.textMuted;

  const circleSizeForScore = (value) => {
    const minSize = 20;
    const maxSize = 50;
    if (value == null || !Number.isFinite(value)) return minSize;
    const clamped = Math.max(0, Math.min(100, Math.round(value)));
    return minSize + ((maxSize - minSize) * clamped) / 100;
  };

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
    if (submitting) return false;
    setSubmitting(true);
    setSubmitError('');
    try {
      await submitCourseRating({
        course_id: course?.id ?? null,
        course_code: course?.course_code ?? null,
        score_relevance: Math.max(0, Math.min(100, Math.round(values.relevance ?? 0))),
        score_personal: Math.max(0, Math.min(100, Math.round(values.skills ?? 0))),
        score_product: Math.max(0, Math.min(100, Math.round(values.product ?? 0))),
        score_venture: Math.max(0, Math.min(100, Math.round(values.venture ?? 0))),
        score_intro: Math.max(0, Math.min(100, Math.round(values.foundations ?? 0))),
        comment_relevance: commentNotes.relevance,
        comment_personal: commentNotes.skills,
        comment_product: commentNotes.product,
        comment_venture: commentNotes.venture,
        comment_intro: commentNotes.foundations,
        user_email: userEmail,
      });
      setSubmitted(true);
      broadcastState({ submitted: true, timestamp: Date.now() });
      return true;
    } catch (err) {
      setSubmitError(err?.message || 'Submit failed');
      broadcastState(null);
      return false;
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

  async function handleModalSubmit() {
    const ok = await handleSubmit();
    if (ok) {
      setShowRatingModal(false);
    }
  }

  return (
    <div
      style={{
        marginTop: 16,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        flexWrap: 'wrap',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        {rows.map((r) => {
          const size = circleSizeForScore(r.base);
          return (
            <div
              key={r.key}
              style={{
                display: 'flex',
                alignItems: 'center',
                minWidth: 40,
              }}
            >
              <div
                title={r.base != null ? `${formatScoreDisplay(r.base)}/100` : 'No data'}
                style={{
                  width: size,
                  height: size,
                  borderRadius: '50%',
                  background: r.color,
                  opacity: r.base != null ? 0.9 : 0.3,
                }}
              />
            </div>
          );
        })}
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          alignItems: 'flex-end',
          minWidth: 112,
          marginRight: 16,
        }}
      >
        <button
          type="button"
          onClick={() => {
            if (courseDescription) {
              setShowCourseDetailModal(true);
            }
          }}
          disabled={!courseDescription}
          style={{
            boxSizing: 'border-box',
            minWidth: 112,
            padding: '0 12px',
            height: 20,
            background: '#FFFFFF',
            border: '1px solid #000000',
            borderRadius: 50,
            fontFamily: '"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            fontStyle: 'normal',
            fontWeight: 300,
            fontSize: 13,
            lineHeight: '145%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            letterSpacing: '-0.005em',
            color: '#000000',
            whiteSpace: 'nowrap',
            cursor: courseDescription ? 'pointer' : 'not-allowed',
            opacity: courseDescription ? 1 : 0.6,
          }}
        >
          Course Detail
        </button>
        <button
          type="button"
          onClick={() => { if (typeof onOpenGraph === 'function') onOpenGraph(); }}
          style={{
            boxSizing: 'border-box',
            minWidth: 112,
            padding: '0 12px',
            height: 20,
            background: '#FFFFFF',
            border: '1px solid #000000',
            borderRadius: 50,
            fontFamily: '"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            fontStyle: 'normal',
            fontWeight: 300,
            fontSize: 13,
            lineHeight: '145%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            letterSpacing: '-0.005em',
            color: '#000000',
            whiteSpace: 'nowrap',
            cursor: 'pointer',
          }}
        >
          Course Graph
        </button>
        <button
          type="button"
          onClick={() => {
            if (isGuest) return;
            setShowRatingModal(true);
            setSubmitError('');
          }}
          disabled={submitting || isGuest}
          aria-label={isGuest ? 'Rating is unavailable in guest mode' : 'Open rating window'}
          title={isGuest ? 'Sign in to rate courses' : 'Open rating window'}
          style={{
            boxSizing: 'border-box',
            minWidth: 112,
            padding: '0 12px',
            height: 20,
            background: '#FFFFFF',
            border: '1px solid #000000',
            borderRadius: 50,
            fontFamily: '"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            fontStyle: 'normal',
            fontWeight: 300,
            fontSize: 13,
            lineHeight: '145%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            letterSpacing: '-0.005em',
            color: '#000000',
            whiteSpace: 'nowrap',
            cursor: submitting || isGuest ? 'not-allowed' : 'pointer',
            opacity: submitting || isGuest ? 0.7 : 1,
          }}
        >
          {isGuest ? 'Sign in to rate' : (submitted ? 'Rated' : 'Rate')}
        </button>
      </div>

      {showRatingModal && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            zIndex: 2000,
          }}
        >
          <div
            style={{
              width: 'min(720px, 100%)',
              maxHeight: 'min(540px, 100%)',
              overflow: 'auto',
              background: THEME_VARS.surface,
              borderRadius: 12,
              border: `1px solid ${THEME_VARS.border}`,
              padding: 16,
              boxShadow: '0 12px 50px rgba(0,0,0,0.25)',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div>
                <div
                  style={{
                    fontFamily: '"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                    fontStyle: 'normal',
                    fontWeight: 300,
                    fontSize: 20,
                    lineHeight: '145%',
                    display: 'flex',
                    alignItems: 'center',
                    textAlign: 'center',
                    letterSpacing: '-0.005em',
                    color: '#000000',
                  }}
                >
                  Rate this course
                </div>
                <div style={{ fontSize: 12, color: THEME_VARS.textMuted }}>Select a score and share a short note for each area.</div>
              </div>
              <button
                type="button"
                aria-label="Close rating window"
                onClick={() => setShowRatingModal(false)}
                style={{
                  border: 'none',
                  background: 'transparent',
                  fontFamily: '"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                  fontStyle: 'normal',
                  fontWeight: 300,
                  fontSize: 20,
                  lineHeight: '145%',
                  letterSpacing: '-0.005em',
                  color: '#000000',
                  cursor: 'pointer',
                }}
              >
                ×
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
              {rows.map((r) => (
                <div
                  key={r.key}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    padding: 10,
                    borderRadius: 15,
                    background: '#F6F6F6',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <div
                      style={{
                        fontFamily: '"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                        fontStyle: 'normal',
                        fontWeight: 300,
                        fontSize: 17,
                        lineHeight: '145%',
                        display: 'flex',
                        alignItems: 'center',
                        textAlign: 'center',
                        letterSpacing: '-0.005em',
                        color: '#000000',
                      }}
                    >
                      {r.label}
                    </div>
                    <div style={{ fontSize: 11, color: THEME_VARS.textMuted }}>
                      Data {r.base != null ? `${formatScoreDisplay(r.base)}` : '–'}
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: THEME_VARS.textMuted }}>
                    {ratingGuidance[r.key]}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <input
                      type="range"
                      min={SCORE_STEP_VALUES[0]}
                      max={SCORE_STEP_VALUES[SCORE_STEP_VALUES.length - 1]}
                      step={SCORE_STEP_SIZE}
                      value={snapToScoreStep(values[r.key])}
                      onChange={(e) => handleValueChange(r.key, Number(e.target.value))}
                      style={{
                        flex: 1,
                        accentColor: r.color,
                        height: 6,
                      }}
                    />
                    <div style={{ minWidth: 40, fontSize: 12, color: THEME_VARS.text }}>
                      {formatScoreDisplay(values[r.key])}
                    </div>
                  </div>
                  <textarea
                    rows={3}
                    value={commentNotes[r.key]}
                    onChange={(e) => handleCommentChange(r.key, e.target.value)}
                    placeholder="Add a short note or example"
                    style={{
                      width: '100%',
                      borderRadius: 6,
                      border: `1px solid ${THEME_VARS.border}`,
                      padding: 8,
                      background: THEME_VARS.surface,
                      color: THEME_VARS.text,
                      resize: 'vertical',
                      fontSize: 12,
                    }}
                  />
                </div>
              ))}
            </div>

            {submitError && (
              <div style={{ color: THEME_VARS.danger, fontSize: 12 }}>
                {submitError}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                onClick={handleModalSubmit}
                disabled={submitting}
                style={{
                  boxSizing: 'border-box',
                  padding: '6px 18px',
                  borderRadius: 50,
                  border: '1px solid #000000',
                  background: '#FFFFFF',
                  color: '#000000',
                  fontFamily: '"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                  fontStyle: 'normal',
                  fontWeight: 300,
                  fontSize: 13,
                  lineHeight: '145%',
                  letterSpacing: '-0.005em',
                  cursor: submitting ? 'not-allowed' : 'pointer',
                  opacity: submitting ? 0.7 : 1,
                }}
              >
                {submitting ? 'Submitting…' : 'Submit rating'}
              </button>
            </div>
          </div>
        </div>
      )}
      {showCourseDetailModal && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            zIndex: 2100,
          }}
          onClick={() => setShowCourseDetailModal(false)}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              width: 'min(720px, 90vw)',
              maxHeight: '80vh',
              overflowY: 'auto',
              borderRadius: 16,
              background: theme === 'dark' ? '#0f172a' : '#ffffff',
              color: theme === 'dark' ? '#f8fafc' : '#0f172a',
              border: '1px solid rgba(15,23,42,0.2)',
              boxShadow: '0 18px 40px rgba(15, 23, 42, 0.35)',
              padding: '24px 28px',
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <h3
                style={{
                  margin: 0,
                  fontFamily: '"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                  fontStyle: 'normal',
                  fontWeight: 300,
                  fontSize: 20,
                  lineHeight: '145%',
                  display: 'flex',
                  alignItems: 'center',
                  textAlign: 'center',
                  letterSpacing: '-0.005em',
                  color: '#000000',
                }}
              >
                {course?.course_name || 'Course Detail'}
              </h3>
              <button
                type="button"
                onClick={() => setShowCourseDetailModal(false)}
                style={{ border: 'none', background: 'transparent', fontSize: 20, cursor: 'pointer', color: 'inherit' }}
                aria-label="Close course detail"
              >
                ×
              </button>
            </div>
            <div style={{ whiteSpace: 'pre-line', lineHeight: 1.6 }}>
              {courseDescription || 'No description available.'}
            </div>
            <div
              style={{
                marginTop: 8,
                fontSize: 12,
                color: '#6B7280',
                fontStyle: 'italic',
                textDecoration: 'underline',
              }}
            >
              AI summarized
            </div>
          </div>
        </div>
      )}
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

function colorForRank(rank) {
  if (!Number.isFinite(rank) || rank < 0) {
    return PARETO_RANK_COLORS[PARETO_RANK_COLORS.length - 1];
  }
  const paletteIndex = Math.min(Math.floor(rank), PARETO_RANK_COLORS.length - 1);
  return PARETO_RANK_COLORS[paletteIndex];
}

const SUPABASE_URL = (import.meta?.env?.SUPABASE_URL || "").replace(/\/$/, "");

function normalizePhotoUrl(rawValue) {
  if (typeof rawValue !== "string") return "";
  const trimmed = rawValue.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  if (SUPABASE_URL && trimmed.startsWith("/storage/")) {
    return `${SUPABASE_URL}${trimmed}`;
  }
  if (SUPABASE_URL && trimmed.startsWith("storage/")) {
    return `${SUPABASE_URL}/${trimmed}`;
  }
  if (typeof window !== "undefined" && window.location?.origin && trimmed.startsWith("/")) {
    return `${window.location.origin}${trimmed}`;
  }
  return trimmed;
}

function derivePhotoFromCardUrl(cardUrlRaw) {
  const cleaned = typeof cardUrlRaw === "string" ? cardUrlRaw.trim() : "";
  if (!cleaned) return "";
  const match = cleaned.match(/people\.epfl\.ch\/(\d{3,})/i);
  if (match && match[1]) {
    return `https://people.epfl.ch/private/common/photos/links/${match[1]}.jpg`;
  }
  return "";
}

function resolveProfilePhotoUrl(profile) {
  if (!profile) return "";
  const candidates = [
    profile.photoUrl,
    profile.photo_url,
    profile.photo,
    profile.image_url,
    profile.avatar_url,
    profile.image,
    derivePhotoFromCardUrl(profile.card_url || profile.url || ""),
  ];
  for (const candidate of candidates) {
    const normalized = normalizePhotoUrl(candidate);
    if (normalized) return normalized;
  }
  return "";
}

function canonicalizeTeacherUrl(urlRaw) {
  const trimmed = typeof urlRaw === "string" ? urlRaw.trim() : "";
  if (!trimmed) return "";
  const withoutQuery = trimmed.split("?")[0].replace(/\/+$/, "");
  try {
    const parsed = new URL(withoutQuery, withoutQuery.startsWith("http") ? undefined : "https://placeholder.invalid");
    const origin = parsed.origin === "https://placeholder.invalid" ? "" : parsed.origin;
    const path = parsed.pathname.replace(/\/+$/, "");
    return `${origin}${path}`;
  } catch {
    return withoutQuery;
  }
}

// Build graph data for the course relation graph: courses, teachers, and teacher intros as nodes.
function buildCourseGraphData(focusCourse, allCourses, profiles) {
  const nodes = [];
  const links = [];
  const nodeIds = new Set();

  const addNode = (node) => {
    if (!node || !node.id) return;
    if (nodeIds.has(node.id)) return;
    nodeIds.add(node.id);
    nodes.push(node);
  };

  const addLink = (link) => {
    if (!link || !link.source || !link.target) return;
    links.push(link);
  };

  const allCoursesList = Array.isArray(allCourses) ? allCourses : [];
  const profileList = Array.isArray(profiles) ? profiles : [];

  // Normalize course identity so we can safely match focus course and related courses.
  const sameCourse = (a, b) => {
    if (!a || !b) return false;
    if (a.id && b.id && a.id === b.id) return true;
    if (a.course_code && b.course_code && a.course_code === b.course_code) {
      return true;
    }
    if (a.url && b.url && a.url === b.url) return true;
    if (a.course_name && b.course_name && a.course_name === b.course_name) {
      return true;
    }
    return false;
  };

  // Prefer the instance from allCoursesList when possible so object identity aligns.
  let focus = null;
  if (focusCourse) {
    focus =
      allCoursesList.find((c) => sameCourse(c, focusCourse)) || focusCourse;
  }

  const courseIdCache = new Map();
  const addCourseNode = (course, isFocus = false) => {
    if (!course) return null;
    if (courseIdCache.has(course)) return courseIdCache.get(course);
    const baseKey =
      course.id ||
      course.course_code ||
      course.url ||
      (course.course_name ? `name:${course.course_name}` : null);
    if (!baseKey) return;
    const id = `course:${baseKey}`;
    addNode({
      id,
      type: "course",
      label: course.course_name || course.course_code || "Course",
      rawCourse: course,
      isFocus,
    });
    courseIdCache.set(course, id);
    return id;
  };

  // Teacher + teacher intro nodes
  const teacherByUrl = new Map();

  const registerTeacherUrl = (urlKey, payload) => {
    if (!urlKey) return;
    teacherByUrl.set(urlKey, payload);
    const canonical = canonicalizeTeacherUrl(urlKey);
    if (canonical && canonical !== urlKey) {
      teacherByUrl.set(canonical, payload);
    }
  };

  profileList.forEach((p) => {
    if (!p) return;
    const teacherKey =
      p.id || p.slug || p.card_url || p.url || p.name || p.person_name;
    if (!teacherKey) return;
    const teacherId = `teacher:${teacherKey}`;
    const introId = `teacherIntro:${teacherKey}`;
    const teacherName = p.name || p.person_name || p.title || "Teacher";

    const photoUrl = resolveProfilePhotoUrl(p);

    addNode({
      id: teacherId,
      type: "teacher",
      label: teacherName,
      rawProfile: p,
      photoUrl,
    });

    // Intro as its own node – 这里就是“老师介绍”那个节点
    addNode({
      id: introId,
      type: "teacherIntro",
      label: "Intro",
      rawProfile: p,
    });

    addLink({
      source: teacherId,
      target: introId,
      kind: "teacher-intro",
    });

    const urlKey = (p.url || p.card_url || "").trim();
    registerTeacherUrl(urlKey, { teacherId, profile: p });
  });

  // Center: focus course node
  const focusCourseId = focus ? addCourseNode(focus, true) : null;

  if (focus && focusCourseId) {
    // Link focus course ↔ teachers using teacher URLs when possible
    const teacherEntries = Array.isArray(focus.teachers) ? focus.teachers : [];
    const teacherNamesFallback = Array.isArray(focus.teacher_names)
      ? focus.teacher_names
      : [];

    teacherEntries.forEach((t) => {
      const url = typeof t?.url === "string" ? t.url.trim() : "";
      if (!url) return;
      const info = teacherByUrl.get(url) || teacherByUrl.get(canonicalizeTeacherUrl(url));
      if (!info) return;
      addLink({
        source: focusCourseId,
        target: info.teacherId,
        kind: "course-teacher",
      });
    });

    // Fallback: if there are teachers only by name and no profile, still show a teacher node
    if (!teacherEntries.length && teacherNamesFallback.length) {
      teacherNamesFallback.forEach((nameRaw) => {
        const name =
          typeof nameRaw === "string" ? nameRaw.trim() : String(nameRaw);
        if (!name) return;
        const teacherId = `teacher:${name}`;
        addNode({
          id: teacherId,
          type: "teacher",
          label: name,
          rawProfile: null,
        });
        addLink({
          source: focusCourseId,
          target: teacherId,
          kind: "course-teacher",
        });
      });
    }

    // Related courses: any other course taught by the same profs (matched by URL)
    allCoursesList.forEach((course) => {
      if (!course || sameCourse(course, focus)) return;
      const entries = Array.isArray(course.teachers) ? course.teachers : [];
      const matchedUrls = [];
      entries.forEach((t) => {
        const urlKey = typeof t?.url === "string" ? t.url.trim() : "";
        if (urlKey && teacherByUrl.has(urlKey)) {
          matchedUrls.push(urlKey);
        } else {
          const canonical = canonicalizeTeacherUrl(urlKey);
          if (canonical && teacherByUrl.has(canonical)) {
            matchedUrls.push(canonical);
          }
        }
      });
      if (!matchedUrls.length) return;

      const relatedId = addCourseNode(course, false);
      matchedUrls.forEach((urlKey) => {
        const info = teacherByUrl.get(urlKey);
        if (!info) return;
        addLink({
          source: relatedId,
          target: info.teacherId,
          kind: "course-teacher",
        });
      });
    });
  }

  return { nodes, links };
}

function CourseGraphModal({ course, courses, profiles, onClose }) {
  const overlayRef = useRef(null);
  const containerRef = useRef(null);
  const fgRef = useRef(null);
  const [canvasSize, setCanvasSize] = useState({ width: 600, height: 400 });

  const graphData = useMemo(
    () => buildCourseGraphData(course, courses, profiles),
    [course, courses, profiles],
  );

  // 让 graph 自适应弹窗大小
  useEffect(() => {
    function updateSize() {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const width = Math.max(320, rect.width);
      const height = Math.max(260, rect.height);
      setCanvasSize({ width, height });
    }
    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  // 添加碰撞力，防止节点重叠
  useEffect(() => {
    if (!fgRef.current) return;
    const collide = d3Force.forceCollide(28);
    fgRef.current.d3Force("collide", collide);
  }, [graphData]);

  const handleOverlayClick = (event) => {
    if (event.target === overlayRef.current) {
      if (typeof onClose === "function") onClose();
    }
  };

  const graphTitle =
    course?.course_name ||
    course?.course_code ||
    "Course Relations";

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      onClick={handleOverlayClick}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 3000,
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "min(960px, 100%)",
          height: "min(640px, 85vh)",
          background: "#ffffff",
          borderRadius: 16,
          padding: 12,
          boxShadow: "0 18px 40px rgba(15, 23, 42, 0.35)",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            padding: "2px 4px 6px",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <div
              style={{
                fontFamily:
                  '"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                fontWeight: 300,
                fontSize: 16,
                letterSpacing: "-0.01em",
                color: "#000000",
              }}
            >
              Course Graph
            </div>
            <div
              style={{
                fontSize: 11,
                color: "#6B7280",
                maxWidth: 520,
              }}
            >
              Drag nodes to rearrange. On Mac you can drag the background or use
              trackpad gestures to explore the whole graph when it doesn&apos;t
              fit in the window.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close course graph"
            style={{
              border: "none",
              background: "transparent",
              fontSize: 20,
              cursor: "pointer",
              color: "#000000",
            }}
          >
            ×
          </button>
        </div>

        <div
          style={{
            flex: "1 1 auto",
            borderRadius: 12,
            border: "1px solid rgba(148, 163, 184, 0.5)",
            overflow: "hidden",
            position: "relative",
          }}
          ref={containerRef}
        >
          <ForceGraph2D
            ref={fgRef}
            width={canvasSize.width}
            height={canvasSize.height}
            graphData={graphData}
            enableNodeDrag
            enableZoomInteraction
            enablePanInteraction
            enablePointerInteraction
            nodeRelSize={4}
            nodeLabel={(node) => {
              if (node.type === "teacherIntro") {
                const p = node.rawProfile || {};
                const intro =
                  p.introduction_summary ||
                  p.introduction ||
                  p.bio ||
                  p.summary ||
                  p.description ||
                  "";
                const tag = "(AI summarized)";
                if (intro) return `${intro}\n${tag}`;
                return `Teacher intro ${tag}`;
              }
              if (node.type === "teacher") {
                const p = node.rawProfile || {};
                const base = node.label || "Teacher";
                const title = p.title || "";
                return title ? `${base} – ${title}` : base;
              }
              if (node.type === "course") {
                return node.label || "Course";
              }
              return node.label || "";
            }}
            linkColor={(link) =>
              link.kind === "teacher-intro"
                ? "rgba(148, 163, 184, 0.8)"
                : "rgba(15, 23, 42, 0.7)"
            }
            linkWidth={(link) =>
              link.kind === "teacher-intro" ? 0.8 : 1.2
            }
            nodeCanvasObject={(node, ctx, globalScale) => {
              const label =
                node.type === "teacherIntro" ? "Intro" : node.label || "";
              const fontSize = 10 / globalScale;
              const isCourse = node.type === "course";
              const isTeacher = node.type === "teacher";
              const isIntro = node.type === "teacherIntro";
              const radius = isCourse ? 10 : isTeacher ? 7 : 5;
              let color = "#4B5563";

              if (isCourse) {
                color = node.isFocus ? "#4A62FF" : "#111827";
              } else if (isTeacher) {
                color = "#FF006F";
              } else if (isIntro) {
                color = "#9CA3AF";
              }

              // Teacher nodes: try to draw professor photo in a circle if available
              const profile = node.rawProfile || {};
              const photoUrl =
                node.photoUrl ||
                resolveProfilePhotoUrl(profile);

              if (isTeacher && photoUrl) {
                const imgSize = radius * 2;
                const triggerRefresh = () => {
                  node.__imgLoaded = true;
                  if (fgRef.current && typeof fgRef.current.refresh === "function") {
                    try {
                      fgRef.current.refresh();
                    } catch (_err) {
                      // ignore
                    }
                  }
                };
                const startLoad = (useCors = true) => {
                  const img = new Image();
                  if (useCors) {
                    img.crossOrigin = "anonymous";
                  }
                  img.onload = triggerRefresh;
                  img.onerror = () => {
                    if (useCors && !node.__imgTriedNoCors) {
                      node.__imgTriedNoCors = true;
                      startLoad(false);
                    }
                  };
                  img.src = photoUrl;
                  node.__img = img;
                  node.__imgSrc = photoUrl;
                };
                if (!node.__img || node.__imgSrc !== photoUrl) {
                  node.__imgTriedNoCors = false;
                  startLoad(true);
                }
                const img = node.__img;
                if (img && img.complete && img.naturalWidth > 0) {
                  ctx.save();
                  ctx.beginPath();
                  ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI, false);
                  ctx.closePath();
                  ctx.clip();
                  ctx.drawImage(
                    img,
                    node.x - radius,
                    node.y - radius,
                    imgSize,
                    imgSize,
                  );
                  ctx.restore();
                  ctx.beginPath();
                  ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI, false);
                  ctx.strokeStyle = "#FF006F";
                  ctx.lineWidth = 1.2 / globalScale;
                  ctx.stroke();
                } else {
                  ctx.beginPath();
                  ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI, false);
                  ctx.fillStyle = color;
                  ctx.fill();
                }
              } else {
                // Default node circle
                ctx.beginPath();
                ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI, false);
                ctx.fillStyle = color;
                ctx.fill();
              }

              // Highlight focus course with a ring
              if (node.isFocus) {
                ctx.beginPath();
                ctx.arc(node.x, node.y, radius + 3, 0, 2 * Math.PI, false);
                ctx.strokeStyle = "#F97316";
                ctx.lineWidth = 1.5 / globalScale;
                ctx.stroke();
              }

              // Label
              if (label) {
                ctx.font = `${fontSize}px "Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
                ctx.textAlign = "center";
                ctx.textBaseline = "top";
                ctx.fillStyle = "#111827";
                ctx.fillText(label, node.x, node.y + radius + 2 / globalScale);
              }
            }}
          />
        </div>

        <div
          style={{
            paddingTop: 4,
            fontSize: 11,
            color: "#9CA3AF",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span>{graphTitle}</span>
          <span>
            Nodes: {graphData.nodes.length} · Links: {graphData.links.length}
          </span>
        </div>
      </div>
    </div>
  );
}

function CoursesList() {
  const location = useLocation();
  const navigate = useNavigate();
  const courseRefs = useRef({});
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(30);
  const [totalResults, setTotalResults] = useState(0);
  const [showFilters, setShowFilters] = useState(false);
  const [studyPlansTree, setStudyPlansTree] = useState(null);
  const [studyPlansMap, setStudyPlansMap] = useState({});
  const [appliedFilters, setAppliedFilters] = useState(() => parseFiltersFromSearch(location.search));
  const [draftFilters, setDraftFilters] = useState(() => parseFiltersFromSearch(location.search));
  const [sortField, setSortField] = useState("");
  const [sortOrder, setSortOrder] = useState("asc");
  const [viewMode, setViewMode] = useState("list"); // 'list' | 'grid'
  const [paretoPref, setParetoPref] = useState({ credits: 'max', workload: 'min' }); // 'max'|'min' for each
  const [submissionStates, setSubmissionStates] = useState({});
  const [ratingValues, setRatingValues] = useState({});
  const [graphOpen, setGraphOpen] = useState(false);
  const [graphCourse, setGraphCourse] = useState(null);
  const [graphProfiles, setGraphProfiles] = useState([]);
  const [graphCoursesList, setGraphCoursesList] = useState([]);
  const [resultsDisplay, setResultsDisplay] = useState('');
  const resultsTickerRef = useRef(null);
  const filterBarRef = useRef(null);
  const [filtersOverlayTop, setFiltersOverlayTop] = useState(0);
  const pageTopRef = useRef(null);
  const focusCourseKey = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return normalizeFocusKey(params.get('focus') || '');
  }, [location.search]);

  const setCourseRef = useCallback((key, node) => {
    const normalized = normalizeFocusKey(key ? String(key) : '');
    if (!normalized) return;
    if (node) {
      courseRefs.current[normalized] = node;
    } else {
      delete courseRefs.current[normalized];
    }
  }, []);

  const updateFiltersOverlayTop = useCallback(() => {
    if (!filterBarRef.current) {
      setFiltersOverlayTop(0);
      return;
    }
    const rect = filterBarRef.current.getBoundingClientRect();
    const nextTop = Math.max(0, rect.bottom);
    setFiltersOverlayTop(nextTop);
  }, []);

  useEffect(() => {
    updateFiltersOverlayTop();
  }, [updateFiltersOverlayTop]);

  useEffect(() => {
    if (!showFilters) return undefined;
    const handleReposition = () => updateFiltersOverlayTop();
    handleReposition();
    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleReposition, { passive: true });
    return () => {
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition);
    };
  }, [showFilters, updateFiltersOverlayTop]);

  useEffect(() => {
    if (resultsTickerRef.current) {
      clearInterval(resultsTickerRef.current);
      resultsTickerRef.current = null;
    }

    if (loading) {
      setResultsDisplay(`${generateRandomResultsNoise()} Results`);
      resultsTickerRef.current = setInterval(() => {
        setResultsDisplay(`${generateRandomResultsNoise()} Results`);
      }, 30);
    } else {
      const safeTotal = Number.isFinite(totalResults) && totalResults >= 0 ? totalResults : 0;
      setResultsDisplay(`${safeTotal} Results`);
    }

    return () => {
      if (resultsTickerRef.current) {
        clearInterval(resultsTickerRef.current);
        resultsTickerRef.current = null;
      }
    };
  }, [loading, totalResults]);

  useEffect(() => {
    if (!pageTopRef.current) return;
    try {
      pageTopRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [page]);

  useEffect(() => {
    if (!focusCourseKey) return undefined;
    const target = courseRefs.current[focusCourseKey];
    if (!target) return undefined;
    const scrollOptions = { behavior: 'smooth', block: 'center', inline: 'nearest' };
    try {
      target.scrollIntoView(scrollOptions);
    } catch (_err) {
      target.scrollIntoView(true);
    }
    target.classList.add('course-focus-highlight');
    const timeout = setTimeout(() => {
      target.classList.remove('course-focus-highlight');
    }, 2500);
    return () => clearTimeout(timeout);
  }, [focusCourseKey, courses]);

  const openRelationGraph = useCallback(async (course) => {
    try {
      const urls = (Array.isArray(course?.teachers) ? course.teachers : [])
        .map((t) => (typeof t?.url === 'string' ? t.url.trim() : ''))
        .filter(Boolean);
      const profiles = await getPeopleProfilesByCardUrls(urls);
      setGraphCourse(course);
      setGraphProfiles(Array.isArray(profiles) ? profiles : []);
      setGraphCoursesList(Array.isArray(courses) ? courses : []);
      setGraphOpen(true);
    } catch (err) {
      console.warn('Failed to open relation graph', err);
      setGraphCourse(course || null);
      setGraphProfiles([]);
      setGraphCoursesList(Array.isArray(courses) ? courses : []);
      setGraphOpen(true);
    }
  }, [courses]);

  const closeRelationGraph = useCallback(() => {
    setGraphOpen(false);
    setGraphCourse(null);
    setGraphProfiles([]);
  }, []);

  const toggleSortField = useCallback((field) => {
    setSortOrder((prevOrder) => (sortField === field ? (prevOrder === 'desc' ? 'asc' : 'desc') : 'desc'));
    setSortField(field);
  }, [sortField]);

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
    async function loadStudyPlansTree() {
      try {
        const response = await fetch('/studyplans_tree.json', { cache: 'no-store' });
        if (!response.ok) {
          throw new Error(`Failed to fetch studyplans_tree.json: ${response.status}`);
        }
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          const snippet = await response.text();
          throw new Error(`Unexpected content-type: ${contentType}. Body starts with: ${snippet.slice(0, 60)}`);
        }
        const json = await response.json();
        if (!cancelled) {
          setStudyPlansTree(json);
        }
      } catch (err) {
        if (!cancelled) {
          setStudyPlansTree(null);
          console.warn('Failed to load studyplans_tree.json', err);
        }
      }
    }
    loadStudyPlansTree();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let active = true;
    async function loadStudyPlans() {
      try {
        const map = await getStudyPlansByProgram();
        if (active) {
          setStudyPlansMap(map);
        }
      } catch (err) {
        console.warn('Failed to load study plans from Supabase', err);
      }
    }
    loadStudyPlans();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const inferred = inferSemesterFromLevel(appliedFilters.study_plan);
    const fallback = appliedFilters.semester || '';
    const finalSemester = inferred || fallback;
    if (finalSemester && finalSemester !== appliedFilters.semester) {
      setAppliedFilters((prev) => ({ ...prev, semester: finalSemester }));
      setDraftFilters((prev) => ({ ...prev, semester: finalSemester }));
    }
  }, [appliedFilters.study_plan]);

useEffect(() => {
    const parsed = parseFiltersFromSearch(location.search);
    setAppliedFilters((prev) => (filtersAreEqual(prev, parsed) ? prev : parsed));
  }, [location.search]);

  useEffect(() => {
    setDraftFilters(appliedFilters);
  }, [appliedFilters]);

  useEffect(() => {
    const params = new URLSearchParams();
    const existingParams = new URLSearchParams(location.search);
    const focusRaw = existingParams.get('focus');

    if (appliedFilters.study_program) params.set('study_program', appliedFilters.study_program);
    if (appliedFilters.study_plan) params.set('study_plan', appliedFilters.study_plan);
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
    if (appliedFilters.availabilitySlots) {
      params.set('freeSlots', appliedFilters.availabilitySlots);
    }
    if (focusRaw) {
      params.set('focus', focusRaw);
    }

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

  const studyProgramOptions = useMemo(() => {
    const treeOptions = getDegreeOptions(studyPlansTree);
    const supaOptions = Object.keys(studyPlansMap || {});
    const merged = [...treeOptions];
    for (const option of supaOptions) {
      if (!merged.includes(option)) merged.push(option);
    }
    return withValueOption(merged, draftFilters.study_program);
  }, [studyPlansMap, studyPlansTree, draftFilters.study_program]);

  const studyPlanOptions = useMemo(
    () => {
      const studyProgram = draftFilters.study_program;
      if (studyProgram) {
        const supaPlans = studyPlansMap[studyProgram];
        if (supaPlans && supaPlans.length) {
          return withValueOption(supaPlans, draftFilters.study_plan);
        }
      }
      return withValueOption(getStudyPlanOptions(studyPlansTree, studyProgram), draftFilters.study_plan);
    },
    [studyPlansMap, studyPlansTree, draftFilters.study_program, draftFilters.study_plan],
  );

  const studyPlanDisabled = !draftFilters.study_program || studyPlanOptions.length === 0;

  const availabilitySelectedSlots = useMemo(
    () => decodeAvailabilitySlots(draftFilters.availabilitySlots),
    [draftFilters.availabilitySlots],
  );

  const updateAvailabilityFilters = useCallback(
    (updater) => {
      setDraftFilters((prev) => {
        const nextSerialized = updater(prev.availabilitySlots || '');
        if (prev.availabilitySlots === nextSerialized) {
          return prev;
        }
        return { ...prev, availabilitySlots: nextSerialized };
      });
      setAppliedFilters((prev) => {
        const nextSerialized = updater(prev.availabilitySlots || '');
        if (prev.availabilitySlots === nextSerialized) {
          return prev;
        }
        return { ...prev, availabilitySlots: nextSerialized };
      });
    },
    [setDraftFilters, setAppliedFilters],
  );

  const handleToggleAvailabilitySlot = useCallback(
    (slotId) => {
      if (!slotId) return;
      updateAvailabilityFilters((current) => toggleAvailabilitySlotValue(current, slotId));
    },
    [updateAvailabilityFilters],
  );

  const handleSetAvailabilitySlot = useCallback(
    (slotId, shouldSelect) => {
      if (!slotId) return;
      updateAvailabilityFilters((current) => setAvailabilitySlotValue(current, slotId, shouldSelect));
    },
    [updateAvailabilityFilters],
  );

  const handleClearAvailabilitySlots = useCallback(() => {
    updateAvailabilityFilters(() => '');
  }, [updateAvailabilityFilters]);

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
        const availabilitySet = decodeAvailabilitySlots(appliedFilters.availabilitySlots);
        const availabilityFilterActive = availabilitySet.size > 0;
        const fetchPageSize = availabilityFilterActive ? 100 : pageSize;

        // Compute multi-key sort priorities and encode for API
        const sortPriorities = buildSortPriorities(sortField, sortOrder);
        const sortKeys = encodeSortKeys(sortPriorities);
        const params = {
          page: availabilityFilterActive ? 1 : page,
          pageSize: fetchPageSize,
          // map UI filters to backend query params
          q: appliedFilters.query || undefined,
          type: appliedFilters.type || undefined,
          semester: appliedFilters.semester || undefined,
          study_program: appliedFilters.study_program || undefined,
          creditsMin: appliedFilters.creditsMin !== "" ? Number(appliedFilters.creditsMin) : undefined,
          creditsMax: appliedFilters.creditsMax !== "" ? Number(appliedFilters.creditsMax) : undefined,
          study_plan: appliedFilters.study_plan || undefined,
          sortField: sortField || undefined,
          sortOrder: sortField ? sortOrder : undefined,
          sortKeys: sortKeys || undefined,
          minRelevance: appliedFilters.minRelevance > 0 ? appliedFilters.minRelevance : undefined,
          minSkills: appliedFilters.minSkills > 0 ? appliedFilters.minSkills : undefined,
          minProduct: appliedFilters.minProduct > 0 ? appliedFilters.minProduct : undefined,
          minVenture: appliedFilters.minVenture > 0 ? appliedFilters.minVenture : undefined,
          minFoundations: appliedFilters.minFoundations > 0 ? appliedFilters.minFoundations : undefined,
          availabilitySlots: appliedFilters.availabilitySlots || undefined,
        };
        let rawItems = [];
        let reportedTotal = 0;

        if (availabilityFilterActive) {
          let currentPage = 1;
          while (true) {
            const data = await getCourses({ ...params, page: currentPage });
            const pageItems = Array.isArray(data.items) ? data.items : [];
            rawItems = rawItems.concat(pageItems);
            reportedTotal = Number(data.total || rawItems.length || 0);

            const reachedEnd = pageItems.length < fetchPageSize || rawItems.length >= reportedTotal;
            if (reachedEnd) break;
            currentPage += 1;
          }
        } else {
          const data = await getCourses(params);
          rawItems = Array.isArray(data.items) ? data.items : [];
          reportedTotal = Number(data.total || rawItems.length || 0);
        }

        const filteredItems = availabilityFilterActive
          ? rawItems.filter((course) => courseMatchesAvailability(course, availabilitySet))
          : rawItems;

        const paginatedItems = availabilityFilterActive
          ? filteredItems.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize)
          : filteredItems;

        setCourses(paginatedItems);
        setTotalResults(availabilityFilterActive ? filteredItems.length : reportedTotal);
      } catch (err) {
        setError(err?.message || "Failed to load courses");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [page, pageSize, appliedFilters, sortField, sortOrder]);

  // Sorted list for list view (client-side sort, multi-key)
  const sortedCourses = useMemo(() => {
    const list = Array.isArray(courses) ? courses.slice() : [];
    // Build sort priority
    let priorities = [];
    const isScoreField = SCORE_SORT_KEYS.includes(sortField);
    if (!sortField) {
      // Default: all scores DESC
      priorities = SCORE_SORT_KEYS.map((f) => ({ field: f, order: 'desc' }));
    } else if (sortField === 'credits' || sortField === 'workload') {
      // Primary: credits/workload (asc/desc). Secondary: all scores DESC (stable within equal primary)
      priorities = [{ field: sortField, order: sortOrder === 'asc' ? 'asc' : 'desc' }]
        .concat(SCORE_SORT_KEYS.map((f) => ({ field: f, order: 'desc' })));
    } else if (isScoreField) {
      // Primary: selected score with chosen order. Secondary: remaining scores DESC.
      const rest = SCORE_SORT_KEYS.filter((f) => f !== sortField);
      priorities = [{ field: sortField, order: sortOrder === 'asc' ? 'asc' : 'desc' }]
        .concat(rest.map((f) => ({ field: f, order: 'desc' })));
    } else {
      // Fallback: keep default
      priorities = SCORE_SORT_KEYS.map((f) => ({ field: f, order: 'desc' }));
    }

    const num = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : -Infinity;
    };

    list.sort((a, b) => {
      for (const p of priorities) {
        let av = a?.[p.field];
        let bv = b?.[p.field];
        // Normalize scores to numbers; credits/workload already numeric-ish
        av = num(av);
        bv = num(bv);
        if (av === bv) continue;
        if (p.order === 'asc') return av - bv;
        return bv - av; // desc
      }
      // Final tie-breaker: course_name asc, then course_code asc
      const an = (a?.course_name || '').toString().toLowerCase();
      const bn = (b?.course_name || '').toString().toLowerCase();
      if (an !== bn) return an < bn ? -1 : 1;
      const ac = (a?.course_code || '').toString().toLowerCase();
      const bc = (b?.course_code || '').toString().toLowerCase();
      if (ac !== bc) return ac < bc ? -1 : 1;
      return 0;
    });

    return list;
  }, [courses, sortField, sortOrder]);

  useEffect(() => {
    setPage(1);
  }, [appliedFilters, sortField, sortOrder]);

  const [isNarrowLayout, setIsNarrowLayout] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const media = window.matchMedia('(max-width: 768px)');
    const update = () => setIsNarrowLayout(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return (
    <div
      ref={pageTopRef}
      style={{ display: "flex", gap: "1rem", position: 'relative' }}
    >
      {/* Left Filter Bar (overlay) */}
      {showFilters && (
        <div
          style={{
            position: 'fixed',
            top: `${filtersOverlayTop}px`,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 1500,
            display: 'flex',
            alignItems: 'stretch',
            justifyContent: 'flex-start',
            pointerEvents: 'auto',
            background: 'linear-gradient(90deg, #FFFFFF 0%, rgba(255, 255, 255, 0.7) 100%)',
          }}
        >
          <div
            style={{
              flex: '0 0 clamp(260px, 32vw, 380px)',
              maxWidth: '90vw',
              padding: '16px 12px',
              boxSizing: 'border-box',
              overflowY: 'auto',
            }}
          >
            <div style={filterPanelStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <h3 style={{ margin: 0 }}>Filters</h3>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    onClick={handleClearFilters}
                    style={filterCapsuleButtonStyle({ variant: 'outline' })}
                  >
                    Clear filters
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowFilters(false)}
                    style={filterCapsuleButtonStyle({ variant: 'ghost' })}
                  >
                    Hide
                  </button>
                </div>
              </div>
              <div style={{ display: "grid", gap: "0.75rem" }}>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!filtersDirty) return;
                    handleApplyFilters();
                  }}
                  style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
                >
                  <input
                    type="text"
                    placeholder="Search name/code/prof"
                    value={draftFilters.query}
                    onChange={(e) => setDraftFilters((f) => ({ ...f, query: e.target.value }))}
                    style={capsuleInputStyle(false)}
                  />
                  <button
                    type="submit"
                    disabled={!filtersDirty}
                    style={{
                      ...filterCapsuleButtonStyle({ variant: 'solid', disabled: !filtersDirty }),
                      width: '100%',
                    }}
                  >
                    Search
                  </button>
                </form>
                <div>
                  <div style={fieldLabelStyle}>Study program</div>
                  <select
                    value={draftFilters.study_program}
                    onChange={(e) => {
                      const nextProgram = e.target.value;
                      setDraftFilters((prev) => ({
                        ...prev,
                        study_program: nextProgram,
                        study_plan: '',
                      }));
                      setAppliedFilters((prev) => ({
                        ...prev,
                        study_program: nextProgram,
                        study_plan: '',
                      }));
                    }}
                    style={selectFieldStyle(false)}
                  >
                    <option value="">Any study program</option>
                    {studyProgramOptions.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <div style={fieldLabelStyle}>Study Plan</div>
                  <select
                    value={draftFilters.study_plan}
                    onChange={(e) => {
                      const nextPlan = e.target.value;
                      const inferredSemester = inferSemesterFromLevel(nextPlan);
                      setDraftFilters((prev) => ({
                        ...prev,
                        study_plan: nextPlan,
                        semester: inferredSemester || prev.semester,
                      }));
                      setAppliedFilters((prev) => ({
                        ...prev,
                        study_plan: nextPlan,
                        semester: inferredSemester || prev.semester,
                      }));
                    }}
                    disabled={studyPlanDisabled}
                    style={selectFieldStyle(studyPlanDisabled)}
                  >
                    <option value="">Any study plan</option>
                    {studyPlanOptions.map((opt) => (
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
                      style={filterCapsuleButtonStyle({ active: draftFilters.type === "optional" })}
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
                      style={filterCapsuleButtonStyle({ active: draftFilters.type === "mandatory" })}
                    >
                      Mandatory
                    </button>
                  </div>
                </div>
                <AvailabilityGrid
                  selectedSlots={availabilitySelectedSlots}
                  onToggleSlot={handleToggleAvailabilitySlot}
                  onSetSlot={handleSetAvailabilitySlot}
                  onClear={handleClearAvailabilitySlots}
                />
                <div>
                  <div style={fieldLabelStyle}>Semester</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => {
                        setDraftFilters((prev) => {
                          const nextSemester = prev.semester === "Fall" ? "" : "Fall";
                          const next = { ...prev, semester: nextSemester };
                          setAppliedFilters((applied) => ({ ...applied, semester: nextSemester }));
                          return next;
                        });
                      }}
                      style={filterCapsuleButtonStyle({ active: draftFilters.semester === "Fall" })}
                    >
                      Fall
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDraftFilters((prev) => {
                          const nextSemester = prev.semester === "Spring" ? "" : "Spring";
                          const next = { ...prev, semester: nextSemester };
                          setAppliedFilters((applied) => ({ ...applied, semester: nextSemester }));
                          return next;
                        });
                      }}
                      style={filterCapsuleButtonStyle({ active: draftFilters.semester === "Spring" })}
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
                      style={capsuleInputStyle(false)}
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
                      style={capsuleInputStyle(false)}
                    />
                  </div>
                </div>
                <div style={{ display: 'grid', gap: 10 }}>
                  {MIN_SCORE_SLIDERS.map(({ key, label }) => {
                    const levelIndex = getScoreStepIndex(draftFilters[key]);
                    return (
                      <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                          <span>{label}</span>
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
          </div>
          <div
            onClick={() => setShowFilters(false)}
            style={{
              flex: 1,
              cursor: 'pointer',
            }}
          />
        </div>
      )}

      {/* Main Content */}
      <div style={{ flex: 1 }}>
        <ScoreLegendRow resultsDisplay={resultsDisplay} />
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
        <div
          ref={filterBarRef}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 24,
            margin: "16px 0",
            flexWrap: "wrap",
          }}
        >
          {/* FILTER pill */}
          <button
            type="button"
            onClick={() => setShowFilters(prev => !prev)}
            style={{
              boxSizing: "border-box",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              width: 83,
              height: 30,
              padding: "0 16px",
              background: "#FFFFFF",
              border: "1px solid #000000",
              borderRadius: 50,
              fontFamily: '"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
              fontStyle: "normal",
              fontWeight: 300,
              fontSize: 16,
              lineHeight: "145%",
              letterSpacing: "-0.005em",
              color: "#000000",
              cursor: "pointer",
            }}
          >
            <img
              src="/navigation_menu.svg"
              alt="Filters"
              style={{ width: 14, height: 14 }}
            />
            <span>FILTER</span>
          </button>

          {/* Sort controls */}
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            {viewMode === "list" ? (
              <>
                <span
                  style={{
                    fontFamily: '"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                    fontStyle: "normal",
                    fontWeight: 300,
                    fontSize: 14,
                    lineHeight: "145%",
                    letterSpacing: "-0.005em",
                    color: "#000000",
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  sort by
                </span>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={() => toggleSortField("credits")}
                    style={{
                      boxSizing: "border-box",
                      height: 20,
                      padding: "0 6px",
                      borderRadius: 50,
                      background: sortField === "credits" ? "#000000" : "#FFFFFF",
                      border: "1px solid #000000",
                      fontFamily: '"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                      fontStyle: "normal",
                      fontWeight: 300,
                      fontSize: 13,
                      lineHeight: "145%",
                      letterSpacing: "-0.005em",
                      color: sortField === "credits" ? "#FFFFFF" : "#000000",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                    }}
                    title="Toggle credits ascending/descending"
                  >
                    credits {sortField === "credits" ? (sortOrder === "asc" ? "↑" : "↓") : ""}
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleSortField("workload")}
                    style={{
                      boxSizing: "border-box",
                      height: 20,
                      padding: "0 6px",
                      borderRadius: 50,
                      background: sortField === "workload" ? "#000000" : "#FFFFFF",
                      border: "1px solid #000000",
                      fontFamily: '"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                      fontStyle: "normal",
                      fontWeight: 300,
                      fontSize: 13,
                      lineHeight: "145%",
                      letterSpacing: "-0.005em",
                      color: sortField === "workload" ? "#FFFFFF" : "#000000",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                    }}
                    title="Toggle workload ascending/descending"
                  >
                    workload {sortField === "workload" ? (sortOrder === "asc" ? "↑" : "↓") : ""}
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleSortField("score_relevance")}
                    style={{
                      boxSizing: "border-box",
                      height: 20,
                      padding: "0 6px",
                      borderRadius: 50,
                      background: sortField === "score_relevance" ? "#000000" : "#FFFFFF",
                      border: "1px solid #000000",
                      fontFamily: '"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                      fontStyle: "normal",
                      fontWeight: 300,
                      fontSize: 13,
                      lineHeight: "145%",
                      letterSpacing: "-0.005em",
                      color: sortField === "score_relevance" ? "#FFFFFF" : "#000000",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                    }}
                    title="Toggle Entrepreneurship Relevance ascending/descending"
                  >
                    entrepreneurship relevance {sortField === "score_relevance" ? (sortOrder === "asc" ? "↑" : "↓") : ""}
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleSortField("score_skills")}
                    style={{
                      boxSizing: "border-box",
                      height: 20,
                      padding: "0 6px",
                      borderRadius: 50,
                      background: sortField === "score_skills" ? "#000000" : "#FFFFFF",
                      border: "1px solid #000000",
                      fontFamily: '"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                      fontStyle: "normal",
                      fontWeight: 300,
                      fontSize: 13,
                      lineHeight: "145%",
                      letterSpacing: "-0.005em",
                      color: sortField === "score_skills" ? "#FFFFFF" : "#000000",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                    }}
                    title="Toggle Personal Development ascending/descending"
                  >
                    personal development {sortField === "score_skills" ? (sortOrder === "asc" ? "↑" : "↓") : ""}
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleSortField("score_product")}
                    style={{
                      boxSizing: "border-box",
                      height: 20,
                      padding: "0 6px",
                      borderRadius: 50,
                      background: sortField === "score_product" ? "#000000" : "#FFFFFF",
                      border: "1px solid #000000",
                      fontFamily: '"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                      fontStyle: "normal",
                      fontWeight: 300,
                      fontSize: 13,
                      lineHeight: "145%",
                      letterSpacing: "-0.005em",
                      color: sortField === "score_product" ? "#FFFFFF" : "#000000",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                    }}
                    title="Toggle Product Innovation ascending/descending"
                  >
                    product innovation {sortField === "score_product" ? (sortOrder === "asc" ? "↑" : "↓") : ""}
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleSortField("score_venture")}
                    style={{
                      boxSizing: "border-box",
                      height: 20,
                      padding: "0 6px",
                      borderRadius: 50,
                      background: sortField === "score_venture" ? "#000000" : "#FFFFFF",
                      border: "1px solid #000000",
                      fontFamily: '"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                      fontStyle: "normal",
                      fontWeight: 300,
                      fontSize: 13,
                      lineHeight: "145%",
                      letterSpacing: "-0.005em",
                      color: sortField === "score_venture" ? "#FFFFFF" : "#000000",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                    }}
                    title="Toggle Venture Ops ascending/descending"
                  >
                    venture ops {sortField === "score_venture" ? (sortOrder === "asc" ? "↑" : "↓") : ""}
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleSortField("score_foundations")}
                    style={{
                      boxSizing: "border-box",
                      height: 20,
                      padding: "0 6px",
                      borderRadius: 50,
                      background: sortField === "score_foundations" ? "#000000" : "#FFFFFF",
                      border: "1px solid #000000",
                      fontFamily: '"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                      fontStyle: "normal",
                      fontWeight: 300,
                      fontSize: 13,
                      lineHeight: "145%",
                      letterSpacing: "-0.005em",
                      color: sortField === "score_foundations" ? "#FFFFFF" : "#000000",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                    }}
                    title="Toggle Startup Basics ascending/descending"
                  >
                    startup basics {sortField === "score_foundations" ? (sortOrder === "asc" ? "↑" : "↓") : ""}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setSortField(""); setSortOrder("desc"); }}
                    style={{
                      boxSizing: "border-box",
                      height: 20,
                      padding: "0 6px",
                      borderRadius: 50,
                      background: "#FFFFFF",
                      border: "1px solid #000000",
                      fontFamily: '"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                      fontStyle: "normal",
                      fontWeight: 300,
                      fontSize: 13,
                      lineHeight: "145%",
                      letterSpacing: "-0.005em",
                      color: "#000000",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                    }}
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
          </div>

          {/* View mode chips */}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: THEME_VARS.textMuted }}>View</span>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`courses-view-toggle-button${viewMode === 'list' ? ' is-active' : ''}`}
              title="List view"
            >
              List
            </button>
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              className={`courses-view-toggle-button${viewMode === 'grid' ? ' is-active' : ''}`}
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
          <div
            style={{
              display: 'flex',
              gap: 16,
              alignItems: 'flex-start',
              flexDirection: isNarrowLayout ? 'column' : 'row',
            }}
          >
            <ul
              style={{
                listStyle: 'none',
                padding: 0,
                margin: 0,
                flex: 1,
              }}
            >
              {sortedCourses.map((c, idx) => {
                if (!isNarrowLayout && idx % 2 !== 0) return null;
                const courseKey = courseKeyOf(c, idx);
                const scheduleLines = splitScheduleLines(c.schedule);
                const courseUrl = c.course_url || c.url || '';
                const scheduleEvents = buildScheduleEvents(scheduleLines);
                const hasSchedule = scheduleEvents.length > 0;
                return (
                  <li
                    key={courseKey}
                    style={{
                      marginBottom: 16,
                    }}
                  >
                    <article
                      ref={(node) => setCourseRef(courseKey, node)}
                      style={{
                        border: 'none',
                        borderRadius: 15,
                        padding: '16px 20px',
                        boxShadow: 'var(--shadow-elevation)',
                        background: '#F6F6F6',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 12,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 8,
                          minWidth: 0,
                        }}
                      >
                        <h3
                          style={{
                            margin: 0,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            justifyContent: 'space-between',
                            fontFamily: '"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                            fontStyle: 'normal',
                            fontWeight: 300,
                            fontSize: 20,
                            lineHeight: '145%',
                            letterSpacing: '-0.005em',
                            color: '#000000',
                          }}
                        >
                          <a
                            href={courseUrl || '#'}
                            target={courseUrl ? '_blank' : '_self'}
                            rel={courseUrl ? 'noreferrer' : undefined}
                            style={{
                              color: 'inherit',
                              textDecoration: 'none',
                              pointerEvents: courseUrl ? 'auto' : 'none',
                              fontWeight: 'inherit',
                            }}
                          >
                            {c.course_name}
                          </a>
                          {c.course_code && (
                            <span
                              style={{
                                fontFamily: '"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                                fontStyle: 'italic',
                                fontWeight: 300,
                                fontSize: 12,
                                lineHeight: '145%',
                                display: 'flex',
                                alignItems: 'center',
                                textAlign: 'center',
                                letterSpacing: '-0.005em',
                                textDecorationLine: 'underline',
                                color: '#000000',
                                marginLeft: 'auto',
                              }}
                            >
                              {c.course_code}
                            </span>
                          )}
                        </h3>
                        {renderStudyPlanTags(c)}
                        {renderProgramTags(c.available_programs, c.study_plan_tags)}
                        {renderLevelTags(c.available_levels)}
                        <div
                          style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: 16,
                            marginTop: 4,
                          }}
                        >
                          <div
                            style={{
                              flex: '1 1 320px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 6,
                              minWidth: 0,
                            }}
                          >
                            <ul style={{ listStyle: 'none', paddingLeft: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                              {buildCourseDetailRows(c, scheduleLines)}
                            </ul>
                          </div>
                          {hasSchedule && (
                            <aside
                              style={{
                                flex: '0 0 186px',
                                minWidth: 186,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 6,
                              }}
                            >
                              <WeekScheduleCalendar events={scheduleEvents} />
                            </aside>
                          )}
                        </div>
                        <ScoreSummary
                          course={c}
                          layout="list"
                          submissionState={submissionStates[courseKey]}
                          onSubmissionStateChange={(state) => updateSubmissionState(courseKey, state)}
                          savedValues={ratingValues[courseKey]}
                          onValuesChange={(vals) => updateRatingValues(courseKey, vals)}
                          onOpenGraph={() => openRelationGraph(c)}
                        />
                      </div>
                    </article>
                  </li>
                );
              })}
            </ul>
            {!isNarrowLayout && (
              <ul
                style={{
                  listStyle: 'none',
                  padding: 0,
                  margin: 0,
                  flex: 1,
                }}
              >
                {sortedCourses.map((c, idx) => {
                  if (idx % 2 !== 1) return null; // 偶数序号（1-based）在右列
                const courseKey = courseKeyOf(c, idx);
                const scheduleLines = splitScheduleLines(c.schedule);
                const courseUrl = c.course_url || c.url || '';
                const scheduleEvents = buildScheduleEvents(scheduleLines);
                const hasSchedule = scheduleEvents.length > 0;
                  return (
                    <li
                      key={courseKey}
                      style={{
                        marginBottom: 16,
                      }}
                    >
                      <article
                        ref={(node) => setCourseRef(courseKey, node)}
                        style={{
                          border: 'none',
                          borderRadius: 15,
                          padding: '16px 20px',
                          boxShadow: 'var(--shadow-elevation)',
                          background: '#F6F6F6',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 12,
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 8,
                            minWidth: 0,
                          }}
                        >
                        <h3
                          style={{
                            margin: 0,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            justifyContent: 'space-between',
                            fontFamily: '"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                            fontStyle: 'normal',
                            fontWeight: 300,
                            fontSize: 20,
                            lineHeight: '145%',
                            letterSpacing: '-0.005em',
                            color: '#000000',
                          }}
                        >
                          <a
                            href={courseUrl || '#'}
                            target={courseUrl ? '_blank' : '_self'}
                            rel={courseUrl ? 'noreferrer' : undefined}
                            style={{
                              color: 'inherit',
                              textDecoration: 'none',
                              pointerEvents: courseUrl ? 'auto' : 'none',
                              fontWeight: 'inherit',
                            }}
                          >
                            {c.course_name}
                          </a>
                          {c.course_code && (
                            <span
                              style={{
                                fontFamily: '"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                                fontStyle: 'italic',
                                fontWeight: 300,
                                fontSize: 12,
                                lineHeight: '145%',
                                display: 'flex',
                                alignItems: 'center',
                                textAlign: 'center',
                                letterSpacing: '-0.005em',
                                textDecorationLine: 'underline',
                                color: '#000000',
                                marginLeft: 'auto',
                              }}
                            >
                              {c.course_code}
                            </span>
                          )}
                        </h3>
                        {renderStudyPlanTags(c)}
                        {renderProgramTags(c.available_programs, c.study_plan_tags)}
                        {renderLevelTags(c.available_levels)}
                        <div
                          style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: 16,
                            marginTop: 4,
                          }}
                        >
                          <div
                            style={{
                              flex: '1 1 320px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 6,
                              minWidth: 0,
                            }}
                          >
                            <ul style={{ listStyle: 'none', paddingLeft: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                              {buildCourseDetailRows(c, scheduleLines)}
                            </ul>
                          </div>
                          {hasSchedule && (
                            <aside
                              style={{
                                flex: '0 0 186px',
                                minWidth: 186,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 6,
                              }}
                            >
                              <WeekScheduleCalendar events={scheduleEvents} />
                            </aside>
                          )}
                        </div>
                          <ScoreSummary
                            course={c}
                            layout="list"
                            submissionState={submissionStates[courseKey]}
                            onSubmissionStateChange={(state) => updateSubmissionState(courseKey, state)}
                            savedValues={ratingValues[courseKey]}
                            onValuesChange={(vals) => updateRatingValues(courseKey, vals)}
                            onOpenGraph={() => openRelationGraph(c)}
                          />
                        </div>
                      </article>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
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
                  const accent = colorForRank(rank === Infinity ? maxRank : rank);
                  return (
                    <article
                      ref={(node) => setCourseRef(courseKey, node)}
                      key={courseKey}
                      style={{
                        border: `2px solid ${accent}`,
                        borderRadius: 8,
                        padding: '12px',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                        background: THEME_VARS.surface,
                        color: THEME_VARS.text,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 10,
                        minHeight: 140
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 8,
                          minWidth: 0,
                        }}
                      >
                        <h3
                          style={{
                            margin: 0,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            fontFamily: '"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                            fontStyle: 'normal',
                            fontWeight: 300,
                            fontSize: 20,
                            lineHeight: '145%',
                            letterSpacing: '-0.005em',
                            color: '#000000',
                          }}
                        >
                          <a
                            href={courseUrl || '#'}
                            target={courseUrl ? '_blank' : '_self'}
                            rel={courseUrl ? 'noreferrer' : undefined}
                            style={{
                              color: 'inherit',
                              textDecoration: 'none',
                              pointerEvents: courseUrl ? 'auto' : 'none',
                              fontWeight: 'inherit',
                            }}
                          >
                            {c.course_name}
                          </a>
                        </h3>
                        {c.course_code && (
                          <div style={{ fontSize: 12, opacity: 0.85 }}>{c.course_code}</div>
                        )}
                        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {buildCourseDetailRows(c, scheduleLines)}
                        </ul>
                        <ScoreSummary
                          course={c}
                          layout="grid"
                          submissionState={submissionStates[courseKey]}
                          onSubmissionStateChange={(state) => updateSubmissionState(courseKey, state)}
                          savedValues={ratingValues[courseKey]}
                          onValuesChange={(vals) => updateRatingValues(courseKey, vals)}
                          onOpenGraph={() => openRelationGraph(c)}
                        />
                      </div>
                    </article>
                  );
                })}
              </div>
            );
          })()
        )}

        <div
          style={{
            marginTop: '1.5rem',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            gap: '16px',
          }}
        >
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            style={{
              padding: '8px 20px',
              borderRadius: 999,
              border: '1px solid #000000',
              backgroundColor: page === 1 ? '#E5E5E5' : '#000000',
              color: page === 1 ? '#777777' : '#FFFFFF',
              cursor: page === 1 ? 'default' : 'pointer',
              fontFamily: '"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
              fontStyle: 'normal',
              fontWeight: 400,
              fontSize: 14,
              lineHeight: '145%',
              minWidth: 96,
            }}
          >
            Previous
          </button>
          <span
            style={{
              fontFamily: '"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
              fontSize: 13,
              color: THEME_VARS.textMuted,
            }}
          >
            Page {page}
          </span>
          {(() => {
            const totalPages = Math.max(1, Math.ceil(totalResults / pageSize));
            const isLast = page >= totalPages;
            return (
              <button
                type="button"
                onClick={() => setPage((p) => p + 1)}
                disabled={isLast}
                style={{
                  padding: '8px 20px',
                  borderRadius: 999,
                  border: '1px solid #000000',
                  backgroundColor: isLast ? '#E5E5E5' : '#000000',
                  color: isLast ? '#777777' : '#FFFFFF',
                  cursor: isLast ? 'default' : 'pointer',
                  fontFamily: '"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                  fontStyle: 'normal',
                  fontWeight: 400,
                  fontSize: 14,
                  lineHeight: '145%',
                  minWidth: 96,
                }}
              >
                Next
              </button>
            );
          })()}
        </div>
      </div>

      {graphOpen && (
        <CourseGraphModal
          course={graphCourse}
          courses={graphCoursesList}
          profiles={graphProfiles}
          onClose={closeRelationGraph}
        />
      )}
    </div>
  );
}

export default CoursesList;
