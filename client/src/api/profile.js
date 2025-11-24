import { supabase } from './supabaseClient';

function deriveProfilePayload(user) {
  const meta = user?.user_metadata || {};
  return {
    id: user?.id,
    email: user?.email || null,
    full_name: meta.full_name || meta.name || null,
  };
}

export async function ensureProfileForUser(user) {
  if (!user?.id) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', user.id)
    .maybeSingle();

  if (error) {
    // If the error is "no rows", proceed to create; otherwise surface.
    const noRows = error?.code === 'PGRST116';
    if (!noRows) {
      throw new Error(error.message);
    }
  }

  if (data?.id) {
    return data;
  }

  const payload = deriveProfilePayload(user);
  const { error: insertError } = await supabase
    .from('profiles')
    .upsert(payload, { onConflict: 'id' });

  if (insertError) {
    throw new Error(insertError.message);
  }

  return payload;
}
