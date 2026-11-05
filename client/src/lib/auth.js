import { requireSupabase } from './supabaseClient'
export async function registerCitizen(values) {
  const { fullName, username, phone, address, email, password } = values
  const { data, error } = await requireSupabase().auth.signUp({ email, password, options: { data: { full_name: fullName, username, phone, residential_address: address } } })
  if (error) throw error
  return data
}
export async function signInCitizen({ email, password }) {
  const client = requireSupabase()
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw error
  const { data: profile, error: profileError } = await client.from('profiles').select('id, full_name, username').single()
  if (profileError) throw profileError
  return { ...data, profile }
}
export async function signInStaff({ email, password }) {
  const client = requireSupabase()
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw error
  const { data: staff, error: staffError } = await client.from('staff_profiles').select('user_id, role, department_id, active').eq('active', true).maybeSingle()
  if (staffError) throw staffError
  if (!staff) { await client.auth.signOut(); throw new Error('This account is not an authorised municipal staff account.') }
  return { ...data, staff }
}
