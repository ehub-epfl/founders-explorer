/* global __SUPABASE_DEV_VARS__ */

import { createClient } from '@supabase/supabase-js';

const VIEW = 'coursebook_course_summary';
const STUDYPLANS_TABLE = 'coursebook_studyplans';

let cachedClient = null;
let cachedClientKey = '';

const SCORE_SORT_COLUMNS = [
  { key: 'score_relevance', column: 'entre_score' },
  { key: 'score_skills', column: 'PD' },
  { key: 'score_product', column: 'PB' },
  { key: 'score_venture', column: 'VB' },
  { key: 'score_foundations', column: 'INTRO' },
];
const SCORE_SORT_COLUMN_SET = new Set(SCORE_SORT_COLUMNS.map((entry) => entry.column));

const PROGRAM_NAME_CANONICALS = new Map([
  ['management technology and entrepreneurship', 'Management, Technology and Entrepreneurship'],
  ['management technology and entrepreneurship minor', 'Management, Technology and Entrepreneurship minor'],
]);

function canonicalProgramKey(value) {
  if (typeof value !== 'string') return '';
  return value
    .toLowerCase()
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function canonicalizeProgramName(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  const key = canonicalProgramKey(trimmed);
  return PROGRAM_NAME_CANONICALS.get(key) || trimmed;
}

export async function getCourses(options = {}) {
  const {
    page = 1,
    pageSize = 30,
    q,
    type,
    semester,
    study_program,
    study_plan,
    creditsMin,
    creditsMax,
    section,
    language,
    sortField,
    sortOrder,
    minRelevance,
    minSkills,
    minProduct,
    minVenture,
    minFoundations,
    availabilitySlots, // reserved for client-side availability filtering
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

  const minRelevanceScore = toNumericOrNull(minRelevance);
  const minSkillsScore = toNumericOrNull(minSkills);
  const minProductScore = toNumericOrNull(minProduct);
  const minVentureScore = toNumericOrNull(minVenture);
  const minFoundationsScore = toNumericOrNull(minFoundations);

  if (minRelevanceScore !== null) {
    query = query.gte('entre_score', minRelevanceScore);
  }
  if (minSkillsScore !== null) {
    query = query.gte('PD', minSkillsScore);
  }
  if (minProductScore !== null) {
    query = query.gte('PB', minProductScore);
  }
  if (minVentureScore !== null) {
    query = query.gte('VB', minVentureScore);
  }
  if (minFoundationsScore !== null) {
    query = query.gte('INTRO', minFoundationsScore);
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

  const normalizedType = normalizeProgramType(type);
  if (normalizedType) {
    query = query.eq('type', normalizedType);
  }

  const normalizedStudyProgram = normalizeStudyProgramValue(study_program);
  const normalizedStudyPlan = normalizeStudyPlanValue(study_plan);

  const programCourseIds = await collectCourseIdsForStudyPlanFilters(supabase, {
    study_program: normalizedStudyProgram,
    study_plan: normalizedStudyPlan,
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

  const orderClauses = [];
  if (orderColumn) {
    const isCreditsOrWorkload = orderColumn === 'credits' || orderColumn === 'workload';
    const isScoreColumn = SCORE_SORT_COLUMN_SET.has(orderColumn);
    orderClauses.push({ column: orderColumn, ascending, nullsFirst: ascending });

    if (isCreditsOrWorkload || isScoreColumn) {
      for (const { column } of SCORE_SORT_COLUMNS) {
        if (isScoreColumn && column === orderColumn) continue;
        orderClauses.push({ column, ascending: false, nullsFirst: false });
      }
    }
  } else {
    for (const { column } of SCORE_SORT_COLUMNS) {
      orderClauses.push({ column, ascending: false, nullsFirst: false });
    }
  }

  orderClauses.push({ column: 'course_name', ascending: true, nullsFirst: true });

  for (const clause of orderClauses) {
    query = query.order(clause.column, {
      ascending: clause.ascending,
      nullsFirst: clause.nullsFirst,
    });
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


  const items = (Array.isArray(data) ? data : []).map(normalizeCourseRecord);

  return {
    items,
    total: typeof count === 'number' ? count : (Array.isArray(data) ? data.length : 0),
    page: resolvedPage,
    pageSize: resolvedPageSize,
  };
}

export async function getStudyPlansByProgram() {
  const { supabaseUrl, supabaseAnonKey } = resolveSupabaseConfig();
  const supabase = ensureSupabaseClient(supabaseUrl, supabaseAnonKey);

  const { data, error } = await supabase
    .from(VIEW)
    .select('study_plans,study_program,study_faculty');

  if (error) {
    throw new Error(`Supabase study plan fetch failed: ${error.message}`);
  }

  const grouped = {};

  const upsertPlan = (programRaw, facultyRaw) => {
    const program = canonicalizeProgramName(programRaw);
    const faculty = normalizeStudyPlanValue(facultyRaw);
    if (!program || !faculty) return;
    const list = grouped[program] || (grouped[program] = []);
    const existingKeys = new Set(list.map((entry) => entry.toLowerCase()));
    if (!existingKeys.has(faculty.toLowerCase())) {
      list.push(faculty);
    }
  };

  for (const row of data || []) {
    const plans = Array.isArray(row?.study_plans) ? row.study_plans : [];
    for (const plan of plans) {
      upsertPlan(plan?.study_program, plan?.study_faculty);
    }
    upsertPlan(row?.study_program, row?.study_faculty);
  }

  for (const key of Object.keys(grouped)) {
    grouped[key].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  }

  return grouped;
}

export async function getPeopleProfilesByCardUrls(cardUrls = []) {
  const urls = Array.isArray(cardUrls) ? cardUrls.filter((u) => typeof u === 'string' && u.trim()) : [];
  if (!urls.length) return [];
  const { supabaseUrl, supabaseAnonKey } = resolveSupabaseConfig();
  const supabase = ensureSupabaseClient(supabaseUrl, supabaseAnonKey);
  const { data, error } = await supabase
    .from('people_profiles')
    .select('id,name,card_url,title,lab_url,photo_url,introduction_summary')
    .in('card_url', urls);
  if (error) {
    console.warn('Supabase people_profiles fetch failed', error);
    return [];
  }
  return Array.isArray(data) ? data : [];
}

function normalizeCourseRecord(row) {
  const teachers = Array.isArray(row?.teachers) ? row.teachers : [];
  const programs = Array.isArray(row?.programs) ? row.programs : [];
  const studyPlansRaw = Array.isArray(row?.study_plans) ? row.study_plans : [];
  const credits = normalizeCreditsValue(row?.credits);
  const workload = normalizeWorkloadValue(row?.workload);

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
      const programName = canonicalizeProgramName(entry?.program_name);
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

  const normalizedStudyPlans = studyPlansRaw
    .map((entry) => {
      const studyProgram = canonicalizeProgramName(entry?.study_program);
      const studyFaculty = canonicalizeProgramName(entry?.study_faculty);
      const studyBlock = typeof entry?.study_block === 'string' ? entry.study_block.trim() : '';
      if (!studyProgram && !studyFaculty && !studyBlock) return null;
      const payload = {};
      if (studyProgram) payload.study_program = studyProgram;
      if (studyFaculty) payload.study_faculty = studyFaculty;
      if (studyBlock) payload.study_block = studyBlock;
      return payload;
    })
    .filter(Boolean);

  const availablePrograms = new Set();
  const availableLevels = new Set();
  const availableLabels = new Set();
  const studyFaculties = new Set();
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

  const scoreRelevance = normalizeScoreValue(row?.entre_score);
  const scoreSkills = normalizeScoreValue(row?.PD);
  const scoreProduct = normalizeScoreValue(row?.PB);
  const scoreVenture = normalizeScoreValue(row?.VB);
  const scoreFoundations = normalizeScoreValue(row?.INTRO);

  const topStudyProgram = canonicalizeProgramName(row?.study_program);
  const topStudyFaculty = canonicalizeProgramName(row?.study_faculty);
  const topStudyBlock = typeof row?.study_block === 'string' ? row.study_block.trim() : '';

  const studyPlanLabels = new Set();
  const appendStudyPlanLabel = ({ study_program, study_faculty, study_block }) => {
    const program = canonicalizeProgramName(study_program);
    const faculty = canonicalizeProgramName(study_faculty);
    const block = typeof study_block === 'string' ? study_block.trim() : '';
    const parts = [program, faculty, block].filter(Boolean);
    if (parts.length) {
      studyPlanLabels.add(parts.join(' • '));
    }
    if (faculty) studyFaculties.add(faculty);
  };

  if (normalizedStudyPlans.length) {
    for (const plan of normalizedStudyPlans) {
      appendStudyPlanLabel(plan);
    }
  }
  if (!studyPlanLabels.size && (topStudyProgram || topStudyFaculty || topStudyBlock)) {
    appendStudyPlanLabel({
      study_program: topStudyProgram,
      study_faculty: topStudyFaculty,
      study_block: topStudyBlock,
    });
  } else if (topStudyFaculty) {
    studyFaculties.add(topStudyFaculty);
  }

  const normalizedFacultySet = new Set(
    Array.from(studyFaculties)
      .map((value) => canonicalProgramKey(value))
      .filter(Boolean),
  );

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
    workload,
    type: typeof row?.type === 'string' ? row.type : null,
    semester: typeof row?.semester === 'string' ? row.semester : null,
    schedule: typeof row?.schedule === 'string' ? row.schedule : '',
    schedule_matrix: Array.isArray(row?.schedule_matrix) ? row.schedule_matrix : null,
    teachers: normalizedTeachers,
    teacher_names: teacherNames,
    teacher_names_text: typeof row?.teacher_names_text === 'string' ? row.teacher_names_text : '',
    programs: normalizedPrograms,
    study_plans: normalizedStudyPlans.length
      ? normalizedStudyPlans
      : (topStudyProgram || topStudyFaculty || topStudyBlock
          ? [{
              ...(topStudyProgram ? { study_program: topStudyProgram } : {}),
              ...(topStudyFaculty ? { study_faculty: topStudyFaculty } : {}),
              ...(topStudyBlock ? { study_block: topStudyBlock } : {}),
            }]
          : []),
    prof_name: teacherNames[0] || null,
    prof_names: teacherNames.length ? teacherNames.join(', ') : null,
    available_programs: Array.from(availablePrograms).filter((name) => {
      const key = canonicalProgramKey(name);
      return key && !normalizedFacultySet.has(key);
    }),
    available_levels: Array.from(availableLevels),
    available_program_labels: Array.from(availableLabels),
    study_plan_labels: Array.from(studyPlanLabels),
    study_plan_tags: Array.from(studyFaculties),
    study_program: topStudyProgram,
    study_faculty: topStudyFaculty,
    study_block: topStudyBlock,
    score_relevance: scoreRelevance,
    score_skills: scoreSkills,
    score_product: scoreProduct,
    score_venture: scoreVenture,
    score_foundations: scoreFoundations,
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
    case 'workload':
      return 'workload';
    case 'score_relevance':
      return 'entre_score';
    case 'score_skills':
      return 'PD';
    case 'score_product':
      return 'PB';
    case 'score_venture':
      return 'VB';
    case 'score_foundations':
      return 'INTRO';
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

function normalizeWorkloadValue(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const numeric = Number(trimmed);
    return Number.isFinite(numeric) ? numeric : trimmed;
  }
  return null;
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

function normalizeScoreValue(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (num < 0) return 0;
  if (num > 100) return 100;
  return Math.round(num);
}

function normalizeStudyProgramValue(value) {
  return canonicalizeProgramName(value);
}

function normalizeStudyPlanValue(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function normalizeProgramType(value) {
  if (typeof value !== 'string') return '';
  const candidate = value.trim().toLowerCase();
  if (candidate === 'mandatory' || candidate === 'optional') {
    return candidate;
  }
  return '';
}

async function collectCourseIdsForStudyPlanFilters(client, filters) {
  const { study_program, study_plan } = filters || {};
  if (!study_program && !study_plan) {
    return null;
  }

  let query = client.from(STUDYPLANS_TABLE).select('course_id');

  if (study_program) {
    query = query.eq('study_program', study_program);
  }
  if (study_plan) {
    query = query.eq('study_faculty', study_plan);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Supabase study plan filter fetch failed: ${error.message}`);
  }

  const ids = new Set();
  for (const row of data || []) {
    const id = row?.course_id;
    if (typeof id === 'number') {
      ids.add(id);
    }
  }

  if (ids.size === 0) {
    return [];
  }

  return Array.from(ids);
}
