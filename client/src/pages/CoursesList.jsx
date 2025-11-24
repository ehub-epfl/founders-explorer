// src/pages/CoursesList.jsx
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getCourses, getLevelsByDegree, getPeopleProfilesByCardUrls } from "../api/courses_api";
import submitCourseRating from "../api/submit_rating";
import { inferSemesterFromLevel } from "../utils/levels";

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
  relevance: '#0ea5e9',
  skills: '#2563eb',
  product: '#10b981',
  venture: '#f59e0b',
  foundations: '#a855f7',
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
                display: 'inline-block',
                background: color,
                color: tagTextColor(color),
                padding: '2px 12px',
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 600,
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
  lecture: 'rgba(14, 165, 233, 0.85)',
  exercise: 'rgba(34, 197, 94, 0.85)',
  lab: 'rgba(249, 115, 22, 0.85)',
  other: 'rgba(107, 114, 128, 0.8)',
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

  const minStart = events.reduce((min, event) => Math.min(min, event.startMinutes), Infinity);
  const maxEnd = events.reduce((max, event) => Math.max(max, event.endMinutes), -Infinity);
  if (!Number.isFinite(minStart) || !Number.isFinite(maxEnd)) {
    return null;
  }

  const anchorStart = Math.min(minStart, 8 * 60);
  const anchorEnd = Math.max(maxEnd, 19 * 60);
  const totalMinutes = Math.max(anchorEnd - anchorStart, 60);
  const heightPx = 180;

  return (
    <div
      style={{
        border: `1px solid ${THEME_VARS.borderSubtle}`,
        borderRadius: 8,
        padding: 8,
        background: THEME_VARS.surfaceMuted,
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${DAY_DEFINITIONS.length}, minmax(0, 1fr))`,
          gap: 4,
          fontSize: 10,
          lineHeight: 1.2,
        }}
      >
        {DAY_DEFINITIONS.map((day) => {
          const dayEvents = events.filter((event) => event.dayIndex === day.index);
          return (
            <div
              key={day.index}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <div style={{ textAlign: 'center', fontWeight: 600, color: THEME_VARS.textMuted }}>
                {day.label}
              </div>
              <div
                style={{
                  position: 'relative',
                  height: heightPx,
                  borderRadius: 6,
                  background: 'rgba(148, 163, 184, 0.15)',
                  overflow: 'hidden',
                }}
              >
                {dayEvents.map((event, idx) => {
                  const top = ((event.startMinutes - anchorStart) / totalMinutes) * 100;
                  const height = ((event.endMinutes - event.startMinutes) / totalMinutes) * 100;
                  const fallbackDayLabel = day.fullLabel || day.label || '';
                  const fallbackTooltip = `${fallbackDayLabel ? `${fallbackDayLabel} ` : ''}${formatMinutesToLabel(event.startMinutes)}\u2013${formatMinutesToLabel(event.endMinutes)}${event.label ? `: ${event.label}` : ''}`;
                  const blockTitle = event.tooltip || event.raw || fallbackTooltip;
                  return (
                    <div
                      key={`${event.raw}-${idx}`}
                      title={blockTitle}
                      style={{
                        position: 'absolute',
                        left: `${EVENT_BLOCK_HORIZONTAL_INSET}px`,
                        right: `${EVENT_BLOCK_HORIZONTAL_INSET}px`,
                        top: `${Math.max(0, top)}%`,
                        height: `${Math.max(8, height)}%`,
                        borderRadius: 4,
                        background: EVENT_COLORS[event.category] || EVENT_COLORS.other,
                        boxShadow: '0 1px 3px rgba(15, 23, 42, 0.25)',
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
            fontSize: 11,
            padding: '2px 6px',
            borderRadius: 4,
            border: `1px solid ${THEME_VARS.borderSubtle}`,
            background: THEME_VARS.surface,
            color: activeSlots.size ? THEME_VARS.textMuted : THEME_VARS.disabledText,
            cursor: activeSlots.size ? 'pointer' : 'not-allowed',
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

function eventFitsSelectedAvailability(event, allowedSlots) {
  if (!(allowedSlots instanceof Set) || allowedSlots.size === 0) return true;
  if (event.startMinutes < AVAILABILITY_GRID_START || event.endMinutes > AVAILABILITY_GRID_END) {
    return false;
  }
  for (const slotStart of AVAILABILITY_SLOT_MINUTES) {
    const slotEnd = slotStart + AVAILABILITY_GRID_STEP;
    if (slotEnd <= event.startMinutes) continue;
    if (slotStart >= event.endMinutes) break;
    const slotId = buildAvailabilitySlotId(event.dayIndex, slotStart);
    if (!allowedSlots.has(slotId)) {
      return false;
    }
  }
  return true;
}

function courseMatchesAvailability(course, allowedSlots) {
  if (!(allowedSlots instanceof Set) || allowedSlots.size === 0) {
    return true;
  }
  const scheduleLines = splitScheduleLines(course?.schedule);
  const events = buildScheduleEvents(scheduleLines);
  if (!events.length) {
    // If the course has no schedule information, include by default.
    return true;
  }
  return events.every((event) => eventFitsSelectedAvailability(event, allowedSlots));
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
  degree: "",
  level: "",
  availabilitySlots: "",
});

const FILTER_KEYS = Object.keys(createDefaultFilters());

function parseFiltersFromSearch(search) {
  const base = createDefaultFilters();
  if (!search) return base;
  const sp = new URLSearchParams(search);
  base.degree = sp.get('degree') || '';
  base.level = sp.get('level') || '';
  base.type = sp.get('type') || '';
  base.semester = sp.get('semester') || '';
  if (base.semester.toLowerCase() === 'winter') base.semester = 'Fall';
  if (base.semester.toLowerCase() === 'summer') base.semester = 'Spring';
  if (base.level && !base.semester) {
    base.semester = inferSemesterFromLevel(base.level) || '';
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

function getLevelOptions(tree, degree) {
  if (!tree || !degree || !tree[degree]) return [];
  const bucket = tree[degree];
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
}) {
  const base = {
    relevance: normalizeScore(course?.score_relevance),
    skills: normalizeScore(course?.score_skills),
    product: normalizeScore(course?.score_product),
    venture: normalizeScore(course?.score_venture),
    foundations: normalizeScore(course?.score_foundations),
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

  const labelMap = layout === 'grid' ? SCORE_LABELS_ABBR : SCORE_LABELS_FULL;
  const rows = [
    { key: 'relevance', label: labelMap.relevance, color: SCORE_COLORS.relevance, base: base.relevance },
    { key: 'skills', label: labelMap.skills, color: SCORE_COLORS.skills, base: base.skills },
    { key: 'product', label: labelMap.product, color: SCORE_COLORS.product, base: base.product },
    { key: 'venture', label: labelMap.venture, color: SCORE_COLORS.venture, base: base.venture },
    { key: 'foundations', label: labelMap.foundations, color: SCORE_COLORS.foundations, base: base.foundations },
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
        score_relevance: Math.max(0, Math.min(100, Math.round(values.relevance ?? 0))),
        score_personal: Math.max(0, Math.min(100, Math.round(values.skills ?? 0))),
        score_product: Math.max(0, Math.min(100, Math.round(values.product ?? 0))),
        score_venture: Math.max(0, Math.min(100, Math.round(values.venture ?? 0))),
        score_intro: Math.max(0, Math.min(100, Math.round(values.foundations ?? 0))),
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
              title={`You: ${formatScoreDisplay(values[r.key])}/100 • Data: ${r.base != null ? `${formatScoreDisplay(r.base)}/100` : '–'}`}
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
                <div style={{ width: r.base != null ? `${Math.round(r.base)}%` : '0%', height: '100%', background: '#9ca3af' }} />
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
                <div style={{ width: `${Math.round(values[r.key])}%`, height: '100%', background: r.color, opacity: 1 }} />
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

function colorForRank(rank) {
  if (!Number.isFinite(rank) || rank < 0) {
    return PARETO_RANK_COLORS[PARETO_RANK_COLORS.length - 1];
  }
  const paletteIndex = Math.min(Math.floor(rank), PARETO_RANK_COLORS.length - 1);
  return PARETO_RANK_COLORS[paletteIndex];
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
  const [studyPlansTree, setStudyPlansTree] = useState(null);
  const [levelsMap, setLevelsMap] = useState({});
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

  const openRelationGraph = useCallback(async (course) => {
    try {
      const urls = (Array.isArray(course?.teachers) ? course.teachers : [])
        .map((t) => (typeof t?.url === 'string' ? t.url.trim() : ''))
        .filter(Boolean);
      const profiles = await getPeopleProfilesByCardUrls(urls);
      setGraphCourse(course);
      setGraphProfiles(Array.isArray(profiles) ? profiles : []);
      setGraphOpen(true);
    } catch (err) {
      console.warn('Failed to open relation graph', err);
      setGraphCourse(course || null);
      setGraphProfiles([]);
      setGraphOpen(true);
    }
  }, []);

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
    () => withValueOption(getDegreeOptions(studyPlansTree), draftFilters.degree),
    [studyPlansTree, draftFilters.degree],
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
      return withValueOption(getLevelOptions(studyPlansTree, degree), draftFilters.level);
    },
    [levelsMap, studyPlansTree, draftFilters.degree, draftFilters.level],
  );

  const levelDisabled = !draftFilters.degree || levelOptions.length === 0;

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
        // Compute multi-key sort priorities and encode for API
        const sortPriorities = buildSortPriorities(sortField, sortOrder);
        const sortKeys = encodeSortKeys(sortPriorities);
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
        const data = await getCourses(params);
        const rawItems = Array.isArray(data.items) ? data.items : [];
        const availabilitySet = decodeAvailabilitySlots(appliedFilters.availabilitySlots);
        const filteredItems = availabilitySet.size > 0
          ? rawItems.filter((course) => courseMatchesAvailability(course, availabilitySet))
          : rawItems;
        setCourses(filteredItems);
        const reportedTotal = availabilitySet.size > 0
          ? filteredItems.length
          : Number(data.total || rawItems.length || 0);
        setTotalResults(reportedTotal);
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
              <div style={fieldLabelStyle}>Study program</div>
              <select
                value={draftFilters.degree}
                onChange={(e) => {
                  const nextDegree = e.target.value;
                  setDraftFilters((prev) => ({
                    ...prev,
                    degree: nextDegree,
                    level: '',
                  }));
                  setAppliedFilters((prev) => ({
                    ...prev,
                    degree: nextDegree,
                    level: '',
                  }));
                }}
                style={selectFieldStyle(false)}
              >
                <option value="">Any study program</option>
                {degreeOptions.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>
            <div>
              <div style={fieldLabelStyle}>Study Plan</div>
              <select
                value={draftFilters.level}
                onChange={(e) => {
                  const nextLevel = e.target.value;
                  const inferredSemester = inferSemesterFromLevel(nextLevel);
                  setDraftFilters((prev) => ({
                    ...prev,
                    level: nextLevel,
                    semester: inferredSemester || prev.semester,
                  }));
                  setAppliedFilters((prev) => ({
                    ...prev,
                    level: nextLevel,
                    semester: inferredSemester || prev.semester,
                  }));
                }}
                disabled={levelDisabled}
                style={selectFieldStyle(levelDisabled)}
              >
                <option value="">Any study plan</option>
                {levelOptions.map((opt) => (
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
                style={chipButtonStyle(draftFilters.semester === "Fall")}
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
                  type="button"
                  onClick={() => toggleSortField("credits")}
                  style={chipButtonStyle(sortField === "credits")}
                  title="Toggle credits ascending/descending"
                >
                  Credits {sortField === "credits" ? (sortOrder === "asc" ? "↑" : "↓") : ""}
                </button>
                <button
                  type="button"
                  onClick={() => toggleSortField("workload")}
                  style={chipButtonStyle(sortField === "workload")}
                  title="Toggle workload ascending/descending"
                >
                  Workload {sortField === "workload" ? (sortOrder === "asc" ? "↑" : "↓") : ""}
                </button>
                {[
                  { key: 'score_relevance', label: 'Entrepreneurship Relevance' },
                  { key: 'score_skills', label: 'Personal Development' },
                  { key: 'score_product', label: 'Product Innovation' },
                  { key: 'score_venture', label: 'Venture Ops' },
                  { key: 'score_foundations', label: 'Startup Basics' },
                ].map(({ key, label }) => (
                  <button
                    type="button"
                    key={key}
                    onClick={() => toggleSortField(key)}
                    style={chipButtonStyle(sortField === key)}
                    title={`Toggle ${label} ascending/descending`}
                  >
                    {label} {sortField === key ? (sortOrder === "asc" ? "↑" : "↓") : ""}
                  </button>
                ))}
                <button
                  onClick={() => { setSortField(""); setSortOrder("desc"); }}
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
            {sortedCourses.map((c, idx) => {
              const courseKey = courseKeyOf(c, idx);
              const scheduleLines = splitScheduleLines(c.schedule);
              const courseUrl = c.course_url || c.url || '';
              const scheduleEvents = buildScheduleEvents(scheduleLines);
              const hasSchedule = scheduleEvents.length > 0;
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
                      <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
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
                        <button
                          type="button"
                          onClick={() => openRelationGraph(c)}
                          title="Show relation graph"
                          style={{
                            marginLeft: 8,
                            padding: '2px 6px',
                            fontSize: 12,
                            lineHeight: '16px',
                            border: `1px solid ${THEME_VARS.border}`,
                            borderRadius: 4,
                            background: THEME_VARS.surface,
                            color: THEME_VARS.text,
                            cursor: 'pointer',
                          }}
                        >
                          Graph
                        </button>
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
                              flex: '0 0 240px',
                              minWidth: 220,
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 6,
                            }}
                          >
                            <div style={{ fontSize: 12, fontWeight: 600, color: THEME_VARS.textMuted, textTransform: 'uppercase' }}>
                              Weekly Schedule
                            </div>
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
                      />
                    </div>
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
                  const accent = colorForRank(rank === Infinity ? maxRank : rank);
                  return (
                    <article
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
                        <h3 style={{ margin: 0, fontSize: 16, lineHeight: '20px', display: 'flex', alignItems: 'center', gap: 6 }}>
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
                          <button
                            type="button"
                            onClick={() => openRelationGraph(c)}
                            title="Show relation graph"
                            style={{
                              marginLeft: 8,
                              padding: '2px 6px',
                              fontSize: 11,
                              lineHeight: '16px',
                              border: `1px solid ${THEME_VARS.border}`,
                              borderRadius: 4,
                              background: THEME_VARS.surface,
                              color: THEME_VARS.text,
                              cursor: 'pointer',
                            }}
                          >
                            Graph
                          </button>
                        </h3>
                        {c.course_code && (
                          <div style={{ fontSize: 12, opacity: 0.85 }}>{c.course_code}</div>
                        )}
                        {renderStudyPlanTags(c)}
                        {renderProgramTags(c.available_programs, c.study_plan_tags)}
                        {renderLevelTags(c.available_levels)}
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
                        />
                      </div>
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
    {graphOpen && (
      <RelationGraphModal course={graphCourse} profiles={graphProfiles} onClose={closeRelationGraph} />
    )}
    </div>
  );
}

export default CoursesList;

function RelationGraphModal({ course, profiles, onClose }) {
  const width = 720;
  const height = 520;
  const cx = width / 2;
  const cy = height / 2;
  const r1 = 120; // teachers ring (reduced distance)
  const r2 = 240; // labs ring
  const TEACHER_R = 28; // professor node radius (larger)
  const BOX_W = 260; // info panel width for wrapped text
  const BOX_H = 220; // info panel height (scrolls if content overflows)
  const BOX_MARGIN = 8;

  const teachers = Array.isArray(course?.teachers) ? course.teachers : [];
  const nTeachers = Math.max(teachers.length, 1);
  const profileByUrl = new Map((profiles || []).filter(Boolean).map((p) => [p.card_url || '', p]));

  const labSet = new Map();
  for (const p of profiles || []) {
    const url = (p?.lab_url || '').trim();
    if (!url) continue;
    if (!labSet.has(url)) {
      let label = url;
      try { label = new URL(url).hostname; } catch (e) {}
      labSet.set(url, { id: url, label });
    }
  }
  const labs = Array.from(labSet.values());

  const teacherPositions = new Map();
  teachers.forEach((t, i) => {
    const angle = (2 * Math.PI * i) / nTeachers - Math.PI / 2;
    teacherPositions.set(t, { x: cx + r1 * Math.cos(angle), y: cy + r1 * Math.sin(angle) });
  });

  const nLabs = Math.max(labs.length, 1);
  const labPositions = new Map();
  labs.forEach((lab, i) => {
    const angle = (2 * Math.PI * i) / nLabs - Math.PI / 2;
    labPositions.set(lab.id, { x: cx + r2 * Math.cos(angle), y: cy + r2 * Math.sin(angle) });
  });

  const edges = [];
  for (const t of teachers) {
    const tp = teacherPositions.get(t);
    if (tp) edges.push({ x1: cx, y1: cy, x2: tp.x, y2: tp.y, kind: 'course-teacher' });
    const profile = t?.url ? profileByUrl.get(t.url) : null;
    if (profile && profile.lab_url && labPositions.has(profile.lab_url)) {
      const lp = labPositions.get(profile.lab_url);
      if (tp && lp) edges.push({ x1: tp.x, y1: tp.y, x2: lp.x, y2: lp.y, kind: 'teacher-lab' });
    }
  }

  const overlayStyle = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000,
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
  };
  const modalStyle = {
    background: 'var(--color-surface)', color: 'var(--color-text)', borderRadius: 10,
    boxShadow: '0 10px 30px rgba(0,0,0,0.35)', width, maxWidth: '95vw', maxHeight: '90vh', overflow: 'auto',
  };
  const headerStyle = {
    padding: '10px 12px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between'
  };
  const bodyStyle = { padding: 12 };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <div style={headerStyle}>
          <div style={{ fontWeight: 600 }}>{course?.course_name || 'Course'}</div>
          <button onClick={onClose} style={{ padding: '4px 8px', border: '1px solid var(--color-border)', borderRadius: 6, background: 'var(--color-surface)' }}>Close</button>
        </div>
        <div style={bodyStyle}>
          <svg width={width} height={height} role="img" aria-label="Relation graph">
            {/* edges */}
            {edges.map((e, idx) => (
              <line key={idx} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke={e.kind === 'course-teacher' ? '#94a3b8' : '#cbd5e1'} strokeWidth={1.5} />
            ))}
            {/* center course node */}
            <circle cx={cx} cy={cy} r={24} fill="#2563eb" />
            <text x={cx} y={cy + 42} textAnchor="middle" fontSize={12} fill="#111">Course</text>
            {/* teacher nodes */}
            {teachers.map((t, i) => {
              const p = teacherPositions.get(t);
              const label = t?.name || 'Teacher';
              const profile = t?.url ? profileByUrl.get(t.url) : null;
              const photo = profile?.photo_url;
              const title = profile?.title || '';
              const email = profile?.email || '';
              const intro = (profile?.introduction_summary || '');
              const href = (typeof t?.url === 'string' && t.url.trim()) ? t.url.trim() : null;
              const dirRight = p.x < cx; // place text on the side away from center
              const linkOffset = TEACHER_R + 6;
              // Compute wrapped panel placement, clamped to viewport
              const panelX = dirRight
                ? Math.min(p.x + TEACHER_R + 12, width - BOX_MARGIN - BOX_W)
                : Math.max(p.x - TEACHER_R - 12 - BOX_W, BOX_MARGIN);
              const panelY = Math.max(BOX_MARGIN, Math.min(p.y - 22, height - BOX_H - BOX_MARGIN));
              const branchX = dirRight ? panelX : panelX + BOX_W;
              const branchY = p.y;
              const node = (
                <g key={`t-${i}`} style={{ cursor: href ? 'pointer' : 'default' }}>
                  {/* avatar (photo clipped to circle) or fallback circle */}
                  {photo ? (
                    <g>
                      <defs>
                        <clipPath id={`clip-t-${i}`}>
                          <circle cx={p.x} cy={p.y} r={TEACHER_R} />
                        </clipPath>
                      </defs>
                      <image
                        href={photo}
                        x={p.x - TEACHER_R}
                        y={p.y - TEACHER_R}
                        width={TEACHER_R * 2}
                        height={TEACHER_R * 2}
                        preserveAspectRatio="xMidYMid slice"
                        clipPath={`url(#clip-t-${i})`}
                      />
                      <circle cx={p.x} cy={p.y} r={TEACHER_R} fill="none" stroke="#065f46" strokeWidth={2} />
                    </g>
                  ) : (
                    <circle cx={p.x} cy={p.y} r={TEACHER_R} fill="#10b981" stroke="#065f46" strokeWidth={2} />
                  )}
                  {/* teacher name label */}
                  <text x={p.x} y={p.y - (TEACHER_R + 6)} textAnchor="middle" fontSize={11} fill="#111" style={{ pointerEvents: 'none' }}>{label}</text>
                  {/* branch with wrapped details: title, intro, email */}
                  {(title || intro || email) && (
                    <g>
                      <line x1={p.x + (dirRight ? linkOffset : -linkOffset)} y1={p.y} x2={branchX} y2={branchY} stroke="#94a3b8" strokeWidth={1} />
                      <foreignObject x={panelX} y={panelY} width={BOX_W} height={BOX_H} requiredExtensions="http://www.w3.org/1999/xhtml">
                        <div xmlns="http://www.w3.org/1999/xhtml" style={{ fontSize: 11, lineHeight: 1.25, color: '#111', background: 'rgba(255,255,255,0.92)', padding: 6, border: '1px solid #e5e7eb', borderRadius: 6, wordWrap: 'break-word', overflowY: 'auto', maxHeight: BOX_H }}>
                          {title && <div style={{ fontWeight: 600, marginBottom: 2 }}>{title}</div>}
                          {intro && <div style={{ color: '#334155', marginBottom: 2 }}>{intro}</div>}
                          {email && <div style={{ color: '#2563eb' }}>{email}</div>}
                        </div>
                      </foreignObject>
                    </g>
                  )}
                </g>
              );
              return href ? (
                <a key={`a-${i}`} href={href} target="_blank" rel="noreferrer">
                  {node}
                </a>
              ) : node;
            })}
            {/* lab nodes */}
            {labs.map((lab, i) => {
              const p = labPositions.get(lab.id);
              return (
                <g key={`l-${i}`}>
                  <circle cx={p.x} cy={p.y} r={14} fill="#f59e0b" />
                  <text x={p.x} y={p.y - 20} textAnchor="middle" fontSize={10} fill="#111" style={{ pointerEvents: 'none' }}>{lab.label}</text>
                </g>
              );
            })}
          </svg>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
            <span style={{ marginRight: 12 }}>• Blue: course</span>
            <span style={{ marginRight: 12 }}>• Green: teachers</span>
            <span>• Orange: labs (from people profile)</span>
          </div>
        </div>
      </div>
    </div>
  );
}
