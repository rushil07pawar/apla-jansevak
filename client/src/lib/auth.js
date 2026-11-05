import { requireSupabase } from './supabaseClient'
const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000'
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
  const userId = data.user?.id
  if (!userId) throw new Error('Unable to identify the signed-in citizen account.')
  const { data: profile, error: profileError } = await client
    .from('profiles')
    .select('id, full_name, username')
    .eq('id', userId)
    .maybeSingle()
  if (profileError) throw profileError
  if (!profile) {
    await client.auth.signOut({ scope: 'local' })
    throw new Error('Your account is signed in, but its citizen profile is missing. Please contact an administrator to restore your profile.')
  }
  return { ...data, profile }
}
export async function signInStaff({ mobile, password }) {
  const response = await fetch(`${apiUrl}/api/staff-auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mobile, password }) })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || 'Unable to sign in with those credentials.')
  const { error } = await requireSupabase().auth.setSession(data.session)
  if (error) throw new Error('Unable to establish your secure session.')
  return data
}
export async function requestStaffPasswordRecovery(mobile) {
  await fetch(`${apiUrl}/api/staff-auth/recovery/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mobile }) })
  return 'If the account is eligible, recovery instructions will be sent.'
}
export async function completeStaffPasswordRecovery({ mobile, token, password }) {
  const response = await fetch(`${apiUrl}/api/staff-auth/recovery/complete`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mobile, token, password }) })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || 'Unable to reset the password.')
  return data.message
}
