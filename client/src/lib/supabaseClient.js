import { createClient } from '@supabase/supabase-js'
const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
export const isSupabaseConfigured = Boolean(url && key)
// Only a publishable key belongs in a browser bundle; never use service_role here.
export const supabase = isSupabaseConfigured ? createClient(url, key) : null
export function requireSupabase() {
  if (!supabase) throw new Error('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to client/.env.local.')
  return supabase
}
