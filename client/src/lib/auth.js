import { requireSupabase } from './supabaseClient'

const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000'

export async function registerCitizen(values) {
  const { fullName, username, phone, address, email, password } = values
  const { data, error } = await requireSupabase().auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName.trim(),
        username: username.trim(),
        phone: phone.trim(),
        residential_address: address.trim(),
      },
    },
  })
  if (error) throw error
  return data
}

export async function getCitizenIdentity() {
  const client = requireSupabase()
  const { data: { user }, error: userError } = await client.auth.getUser()
  if (userError) throw userError
  if (!user) throw new Error('You must sign in to continue.')

  const { data: staff, error: staffError } = await client
    .from('staff_profiles')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (staffError) throw staffError
  if (staff) {
    const error = new Error('This is a municipal staff account. Please use Municipal Staff Login.')
    error.code = 'STAFF_ACCOUNT'
    throw error
  }

  const { data: profile, error: profileError } = await client
    .from('profiles')
    .select('id, full_name, username')
    .eq('id', user.id)
    .maybeSingle()
  if (profileError) throw profileError
  if (!profile) {
    await client.auth.signOut({ scope: 'local' })
    throw new Error('Your account is signed in, but its citizen profile is missing. Please contact an administrator to restore your profile.')
  }

  return { user, profile }
}

export async function signInCitizen({ email, password }) {
  const client = requireSupabase()
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw error
  const identity = await getCitizenIdentity()
  return { ...data, ...identity }
}

export async function signInStaff({ mobile, password }) {
  const response = await fetch(`${apiUrl}/api/staff-auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mobile, password }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || 'Unable to sign in with those credentials.')
  if (!data.session || !data.staff) throw new Error('Unable to verify this staff session.')

  const { error } = await requireSupabase().auth.setSession(data.session)
  if (error) throw new Error('Unable to establish your secure session.')
  return data
}

export async function requestStaffPasswordRecovery(mobile) {
  const response = await fetch(`${apiUrl}/api/staff-auth/recovery/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mobile }),
  })
  if (!response.ok) throw new Error('Unable to request password recovery.')
  return 'If the account is eligible, recovery instructions will be sent.'
}

export async function completeStaffPasswordRecovery({ mobile, token, password }) {
  const response = await fetch(`${apiUrl}/api/staff-auth/recovery/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mobile, token, password }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || 'Unable to reset the password.')
  return data.message
}
