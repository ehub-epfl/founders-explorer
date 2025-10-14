/* global __SUPABASE_DEV_VARS__ */

import { createClient } from '@supabase/supabase-js';

const VIEW = 'coursebook_course_summary';
const PROGRAMS_TABLE = 'coursebook_programs';

let cachedClient = null;
let cachedClientKey = '';

export async function getCourses(options = {}) {
  const {
    page = 1,
    pageSize = 30,
    q,
    type,
    semester,
    degree,
    level,
    major,
    minor,
    creditsMin,
    creditsMax,
    section,
    language,
    sortField,
    sortOrder,
  } = options;

  const { supabaseUrl, supabaseAnonKey } = resolveSupabaseConfig();
  const supabase = ensureSupabaseClient(supabaseUrl, supabaseAnonKey);

  const resolvedPageSize = clampPageSize(pageSize);
  const resolvedPage = clampPage(page);
  const offset = (resolvedPage - 1) * resolvedPageSize;
  const rangeEnd = offset + resolvedPageSize - 1;

  let query = supabase.from(VIEW).select('*', { count: 'exact' });

  const searchClause = buildSearchClause(q);
  if (searchClause) {
    query = query.or(searchClause);
  }

  if (section) {
    query = query.eq('section', String(section));
  }

  if (language) {
    const normalizedLanguage = String(language).trim();
    if (normalizedLanguage) {
      query = query.ilike('language', `%${normalizedLanguage}%`);
    }
  }

  const minCredits = toNumericOrNull(creditsMin);
  const maxCredits = toNumericOrNull(creditsMax);
  if (minCredits !== null) {
    query = query.gte('credits', minCredits);
  }
  if (maxCredits !== null) {
    query = query.lte('credits', maxCredits);
  }

  const programCourseIds = await collectCourseIdsForProgramFilters(supabase, {
    type,
    semester,
    degree,
    level,
    major,
    minor,
  });

  if (programCourseIds && programCourseIds.length === 0) {
    return {
      items: [],
      total: 0,
      page: resolvedPage,
      pageSize: resolvedPageSize,
    };
  }

  if (programCourseIds && programCourseIds.length > 0) {
    query = query.in('id', programCourseIds);
  }

  const orderColumn = mapSortField(sortField);
  const ascending = String(sortOrder).toLowerCase() === 'asc';

  if (orderColumn) {
    query = query.order(orderColumn, { ascending, nullsFirst: ascending });
  } else {
    query = query.order('course_name', { ascending: true });
  }

  query = query.range(offset, rangeEnd);

  const { data, count, error, status } = await query;

  if (error) {
    if (status === 404) {
      console.warn('Supabase returned 404, treating as empty result set', error);
      return {
        items: [],
        total: 0,
        page: resolvedPage,
        pageSize: resolvedPageSize,
      };
    }
    throw new Error(`Supabase request failed: ${error.message}`);
  }

  if (typeof console !== 'undefined') {
    const itemsCount = Array.isArray(data) ? data.length : 0;
    console.log(`[supabase] Retrieved ${itemsCount} rows from ${VIEW} (page ${resolvedPage}, total ${count ?? 'unknown'})`);
  }

  const items = (Array.isArray(data) ? data : []).map(normalizeCourseRecord);

  return {
    items,
    total: typeof count === 'number' ? count : (Array.isArray(data) ? data.length : 0),
    page: resolvedPage,
    pageSize: resolvedPageSize,
  };
}

export async function getLevelsByDegree() {
  const { supabaseUrl, supabaseAnonKey } = resolveSupabaseConfig();
  const supabase = ensureSupabaseClient(supabaseUrl, supabaseAnonKey);

  const { data, error } = await supabase
    .from(PROGRAMS_TABLE)
    .select('semester');

  if (error) {
    throw new Error(`Supabase levels fetch failed: ${error.message}`);
  }

  const grouped = {};
  for (const row of data || []) {
    if (!row) continue;
    const labelRaw = typeof row.semester === 'string' ? row.semester.trim() : '';
    if (!labelRaw) continue;
    const degreeMatch = labelRaw.match(/^[A-Za-z]+/);
    const degree = degreeMatch ? degreeMatch[0].toUpperCase() : 'OTHER';
    const list = grouped[degree] || (grouped[degree] = []);
    if (!list.includes(labelRaw)) {
      list.push(labelRaw);
    }
  }

  for (const key of Object.keys(grouped)) {
    grouped[key].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  }

  return grouped;
}

function normalizeCourseRecord(row) {
  const teachers = Array.isArray(row?.teachers) ? row.teachers : [];
  const programs = Array.isArray(row?.programs) ? row.programs : [];
  const credits = normalizeCreditsValue(row?.credits);

  const normalizedTeachers = teachers
    .map((entry) => {
      const name = typeof entry?.name === 'string' ? entry.name.trim() : '';
      const url = typeof entry?.url === 'string' ? entry.url.trim() : '';
      if (!name) return null;
      return {
        name,
        ...(url ? { url } : {}),
      };
    })
    .filter(Boolean);

  const teacherNamesFromColumn = Array.isArray(row?.teacher_names) ? row.teacher_names : [];
  const teacherNamesCombined = [
    ...normalizedTeachers.map((t) => t.name),
    ...teacherNamesFromColumn.map((name) => (typeof name === 'string' ? name.trim() : '')).filter(Boolean),
  ];
  const teacherNames = Array.from(new Set(teacherNamesCombined.filter(Boolean)));

  const normalizedPrograms = programs
    .map((entry) => {
      const programName = typeof entry?.program_name === 'string' ? entry.program_name.trim() : '';
      const level = typeof entry?.level === 'string' ? entry.level.trim() : '';
      const semester = typeof entry?.semester === 'string' ? entry.semester.trim() : '';
      const examForm = typeof entry?.exam_form === 'string' ? entry.exam_form.trim() : '';
      const programType = typeof entry?.type === 'string' ? entry.type.trim() : '';
      if (!programName && !level && !semester && !examForm && !programType) return null;
      const payload = {};
      if (programName) payload.program_name = programName;
      if (level) payload.level = level;
      if (semester) payload.semester = semester;
      if (examForm) payload.exam_form = examForm;
      if (programType) payload.type = programType;
      return Object.keys(payload).length ? payload : null;
    })
    .filter(Boolean);

  const availablePrograms = new Set();
  const availableLevels = new Set();
  const availableLabels = new Set();
  for (const program of normalizedPrograms) {
    if (program.program_name) {
      availablePrograms.add(program.program_name);
    }
    if (program.level) {
      availableLevels.add(program.level);
    }
    if (program.program_name && program.level) {
      const seasonSuffix = program.semester ? ` (${program.semester})` : '';
      availableLabels.add(`${program.level} ${program.program_name}${seasonSuffix}`.trim());
    } else if (program.program_name) {
      availableLabels.add(program.program_name);
    } else if (program.level) {
      availableLabels.add(program.level);
    }
  }

  return {
    id: row?.id ?? null,
    unique_code: row?.unique_code ?? null,
    course_key: row?.course_key ?? null,
    course_name: row?.course_name ?? '',
    course_code: row?.course_key ?? null,
    section: row?.section ?? '',
    course_url: row?.course_url ?? '',
    language: row?.language ?? '',
    credits,
    type: typeof row?.type === 'string' ? row.type : null,
    semester: typeof row?.semester === 'string' ? row.semester : null,
    schedule: typeof row?.schedule === 'string' ? row.schedule : '',
    teachers: normalizedTeachers,
    teacher_names: teacherNames,
    teacher_names_text: typeof row?.teacher_names_text === 'string' ? row.teacher_names_text : '',
    programs: normalizedPrograms,
    prof_name: teacherNames[0] || null,
    prof_names: teacherNames.length ? teacherNames.join(', ') : null,
    available_programs: Array.from(availablePrograms),
    available_levels: Array.from(availableLevels),
    available_program_labels: Array.from(availableLabels),
    max_score_relevance_sigmoid: row?.max_score_relevance_sigmoid ?? null,
    max_score_skills_sigmoid: row?.max_score_skills_sigmoid ?? null,
    max_score_product_sigmoid: row?.max_score_product_sigmoid ?? null,
    max_score_venture_sigmoid: row?.max_score_venture_sigmoid ?? null,
    max_score_foundations_sigmoid: row?.max_score_foundations_sigmoid ?? null,
  };
}

function ensureSupabaseClient(url, anonKey) {
  const normalizedUrl = url.replace(/\/$/, '');
  const cacheKey = `${normalizedUrl}::${anonKey}`;

  if (!cachedClient || cachedClientKey !== cacheKey) {
    cachedClient = createClient(normalizedUrl, anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    cachedClientKey = cacheKey;
  }

  return cachedClient;
}

function resolveSupabaseConfig() {
  const devVarsRaw = typeof __SUPABASE_DEV_VARS__ !== 'undefined' ? __SUPABASE_DEV_VARS__ : {};
  const devVars = typeof devVarsRaw === 'string' ? safeParseJson(devVarsRaw) : devVarsRaw;
  const supabaseUrl = readEnvString('SUPABASE_URL') || devVars.SUPABASE_URL || '';
  const supabaseAnonKey = readEnvString('SUPABASE_ANON_KEY') || devVars.SUPABASE_ANON_KEY || '';

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase environment variables are not configured');
  }

  return { supabaseUrl, supabaseAnonKey };
}

function buildSearchClause(rawValue) {
  if (typeof rawValue !== 'string') return '';
  const trimmed = rawValue.trim();
  if (!trimmed) return '';

  const sanitized = trimmed
    .replace(/[^a-zA-Z0-9\s._-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!sanitized) return '';

  const wildcard = sanitized.replace(/\s+/g, ' ');
  const pattern = `*${wildcard}*`;
  const parts = [
    `course_name.ilike.${pattern}`,
    `course_key.ilike.${pattern}`,
    `teacher_names_text.ilike.${pattern}`,
    `language.ilike.${pattern}`,
    `section.ilike.${pattern}`,
  ];

  return parts.join(',');
}

function mapSortField(field) {
  switch (String(field)) {
    case 'course_name':
      return 'course_name';
    case 'language':
      return 'language';
    case 'section':
      return 'section';
    case 'credits':
      return 'credits';
    default:
      return null;
  }
}

function readEnvString(key) {
  const raw = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env[key] : undefined;
  return typeof raw === 'string' ? raw.trim() : '';
}

function safeParseJson(source) {
  try {
    return JSON.parse(source);
  } catch {
    return {};
  }
}

function clampPageSize(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return 30;
  return Math.min(Math.trunc(num), 100);
}

function clampPage(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 1) return 1;
  return Math.trunc(num);
}

function toNumericOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeCreditsValue(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const numeric = Number(value.trim());
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
}

function normalizeSeasonValue(value) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim().toLowerCase();
  if (!normalized) return '';
  if (normalized.includes('fall') || normalized.includes('autumn')) {
    return 'Fall';
  }
  if (normalized.includes('spring')) {
    return 'Spring';
  }
  return value.trim();
}

async function collectCourseIdsForProgramFilters(client, filters) {
  const {
    type,
    semester,
    degree,
    level,
    major,
    minor,
  } = filters || {};

  const normalizedType = normalizeProgramType(type);
  const normalizedLevel = typeof level === 'string' ? level.trim() : '';
  const normalizedSeason = normalizeSeasonValue(semester);
  const normalizedDegree = typeof degree === 'string' ? degree.trim().toUpperCase() : '';
  const normalizedMajor = typeof major === 'string' ? major.trim() : '';
  const normalizedMinor = typeof minor === 'string' ? minor.trim() : '';

  const requirementSets = [];

  async function fetchProgramCourseIds(programName, fallbackType) {
    let query = client
      .from(PROGRAMS_TABLE)
      .select('course_id')
      .eq('program_name', programName);

    const enforcedType = normalizedDegree === 'PHD' ? null : (normalizedType || fallbackType);
    if (enforcedType) {
      query = query.eq('program_type', enforcedType);
    }

    if (normalizedDegree === 'PHD') {
      query = query.eq('level', 'Doctoral School');
    }

    if (normalizedSeason) {
      query = query.eq('semester', normalizedSeason);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Supabase program-filter fetch failed: ${error.message}`);
    }
    return extractCourseIdSet(data);
  }

  if (normalizedType || normalizedLevel || normalizedSeason || normalizedDegree) {
    requirementSets.push(async () => {
      let query = client
        .from(PROGRAMS_TABLE)
        .select('course_id');

      if (normalizedType) {
        query = query.eq('program_type', normalizedType);
      }

      if (normalizedLevel) {
        query = query.eq('level', normalizedLevel);
      } else if (normalizedDegree) {
        if (normalizedDegree === 'PHD') {
          query = query.eq('level', 'Doctoral School');
        } else {
          query = query.ilike('level', `${normalizedDegree}%`);
        }
      }

      if (normalizedSeason) {
        query = query.eq('semester', normalizedSeason);
      }

      const { data, error } = await query;
      if (error) {
        throw new Error(`Supabase program-filter fetch failed: ${error.message}`);
      }
      return extractCourseIdSet(data);
    });
  }

  if (normalizedMajor && normalizedMinor) {
    requirementSets.push(async () => {
      const [majorSet, minorSet] = await Promise.all([
        fetchProgramCourseIds(normalizedMajor, 'mandatory'),
        fetchProgramCourseIds(normalizedMinor, 'optional'),
      ]);
      const union = new Set(majorSet);
      for (const value of minorSet) union.add(value);
      return union;
    });
  } else if (normalizedMajor) {
    requirementSets.push(() => fetchProgramCourseIds(normalizedMajor, 'mandatory'));
  } else if (normalizedMinor) {
    requirementSets.push(() => fetchProgramCourseIds(normalizedMinor, 'optional'));
  }

  if (requirementSets.length === 0) {
    return null;
  }

  let result = null;
  for (const fetchSet of requirementSets) {
    const ids = await fetchSet();
    if (ids.size === 0) {
      return [];
    }
    result = result ? intersectCourseIdSets(result, ids) : ids;
    if (result.size === 0) {
      return [];
    }
  }

  return result ? Array.from(result) : [];
}

function normalizeProgramType(value) {
  if (typeof value !== 'string') return '';
  const candidate = value.trim().toLowerCase();
  if (candidate === 'mandatory' || candidate === 'optional') {
    return candidate;
  }
  return '';
}

function extractCourseIdSet(rows) {
  const set = new Set();
  for (const row of rows || []) {
    const id = row?.course_id;
    if (typeof id === 'number') {
      set.add(id);
    }
  }
  return set;
}

function intersectCourseIdSets(a, b) {
  const smaller = a.size <= b.size ? a : b;
  const larger = a.size > b.size ? a : b;
  const result = new Set();
  for (const value of smaller) {
    if (larger.has(value)) {
      result.add(value);
    }
  }
  return result;
}
