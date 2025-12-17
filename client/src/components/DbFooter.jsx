import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.SUPABASE_URL;
const supabaseAnonKey = import.meta.env.SUPABASE_ANON_KEY;

function DbFooter() {
  const [lastUpdatedIso, setLastUpdatedIso] = useState('');
  const [counts, setCounts] = useState({
    courses: null,
    teachers: null,
    studyplans: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function loadMetadata() {
      if (!supabaseUrl || !supabaseAnonKey) return;

      try {
        const supabase = createClient(supabaseUrl, supabaseAnonKey, {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
          },
        });

        const { data, error } = await supabase
          .from('db_metadata')
          .select('csv_last_updated_at,courses_count,teachers_count,studyplans_count')
          .eq('label', 'coursebook')
          .limit(1)
          .maybeSingle();

        if (error || !data) {
          return;
        }

        if (!cancelled) {
          if (typeof data.csv_last_updated_at === 'string') {
            setLastUpdatedIso(data.csv_last_updated_at);
          }
          setCounts({
            courses: typeof data.courses_count === 'number' ? data.courses_count : null,
            teachers: typeof data.teachers_count === 'number' ? data.teachers_count : null,
            studyplans: typeof data.studyplans_count === 'number' ? data.studyplans_count : null,
          });
        }
      } catch {
        // Ignore failures; footer will fall back to minimal text.
      }
    }

    loadMetadata();
    return () => {
      cancelled = true;
    };
  }, []);

  let formattedDate = 'unknown';
  if (lastUpdatedIso) {
    const date = new Date(lastUpdatedIso);
    if (!Number.isNaN(date.getTime())) {
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = date.getFullYear();
      formattedDate = `${day}/${month}/${year}`;
    }
  }

  const countsParts = [];
  if (counts.courses != null) countsParts.push(`${counts.courses} courses`);
  if (counts.teachers != null) countsParts.push(`${counts.teachers} teachers`);
  if (counts.studyplans != null) countsParts.push(`${counts.studyplans} studyplans`);

  const pieces = [`database last updated at ${formattedDate}`];
  if (countsParts.length > 0) {
    pieces.push(`(${countsParts.join(', ')})`);
  }
  pieces.push('developed by Jenny Yi-Chen Pai');

  const line = pieces.join(' ');

  return (
    <div
      style={{
        fontFamily: '"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        fontStyle: 'italic',
        fontWeight: 300,
        textDecoration: 'underline',
        fontSize: '12px',
        textAlign: 'center',
        marginTop: '32px',
        marginBottom: '24px',
        color: '#444444',
      }}
    >
      {line}
    </div>
  );
}

export default DbFooter;
