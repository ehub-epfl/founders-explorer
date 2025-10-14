const MA_PROJECT_LEVELS = ['MA Project Fall', 'MA Project Spring'];

function normalizeLevelLabel(level) {
  return typeof level === 'string' ? level.trim() : '';
}

function toLower(value) {
  return normalizeLevelLabel(value).toLowerCase();
}

function isMAProjectLevel(level) {
  const normalized = toLower(level);
  if (!normalized) return false;
  return MA_PROJECT_LEVELS.some((option) => option.toLowerCase() === normalized);
}

function inferSemesterFromLevel(level) {
  const label = normalizeLevelLabel(level);
  if (!label) return '';
  const lower = label.toLowerCase();
  if (lower.includes('spring')) return 'Spring';
  if (lower.includes('autumn') || lower.includes('fall')) return 'Fall';
  const match = label.match(/(\d+)/);
  if (match) {
    const num = Number(match[1]);
    if (Number.isFinite(num)) {
      return num % 2 === 0 ? 'Spring' : 'Fall';
    }
  }
  return '';
}

function inferMinorSeasonLabel(degree, level) {
  if (degree !== 'MA') return '';
  const label = normalizeLevelLabel(level);
  if (!label) return '';
  const match = label.match(/MA(\d+)/i);
  if (match) {
    const idx = Number(match[1]);
    if (Number.isFinite(idx)) {
      return idx % 2 === 1 ? 'Minor Autumn Semester' : 'Minor Spring Semester';
    }
  }
  const lower = label.toLowerCase();
  if (lower.includes('autumn') || lower.includes('fall')) return 'Minor Autumn Semester';
  if (lower.includes('spring')) return 'Minor Spring Semester';
  return '';
}

function shouldSkipMinorQuestion(degree, level) {
  if (degree !== 'MA') return true;
  return isMAProjectLevel(level);
}

export {
  MA_PROJECT_LEVELS,
  inferMinorSeasonLabel,
  inferSemesterFromLevel,
  isMAProjectLevel,
  shouldSkipMinorQuestion,
};
