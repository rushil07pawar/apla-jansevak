import { requireSupabase } from './supabaseClient'

const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000'

function withRequestContext(error, operation) {
  if (error instanceof TypeError && /fetch/i.test(error.message)) {
    const networkError = new Error(`Could not reach Supabase while ${operation}. Check your network and the deployment's Supabase URL, then retry.`)
    networkError.code = 'NETWORK_ERROR'
    return networkError
  }
  return error
}

export async function registerCitizen(values) {
  const { fullName, username, phone, address, email, password } = values
  let result
  try {
    result = await requireSupabase().auth.signUp({
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
  } catch (error) {
    throw withRequestContext(error, 'creating your citizen account')
  }
  const { data, error } = result
  if (error) throw error
  return data
}

export async function getCitizenIdentity(authenticatedUser) {
  const client = requireSupabase()
  let user = authenticatedUser
  if (authenticatedUser) {
    let result
    try {
      result = await client.auth.getSession()
    } catch (error) {
      throw withRequestContext(error, 'verifying your sign-in session')
    }
    const { data: { session }, error: sessionError } = result
    if (sessionError) throw sessionError
    if (!session || session.user.id !== authenticatedUser.id) {
      throw new Error('Your sign-in session could not be verified. Please sign in again.')
    }
    user = session.user
  } else {
    let result
    try {
      result = await client.auth.getUser()
    } catch (error) {
      throw withRequestContext(error, 'verifying your sign-in session')
    }
    const { data: { user: verifiedUser }, error: userError } = result
    if (userError) throw withRequestContext(userError, 'verifying your sign-in session')
    user = verifiedUser
  }
  if (!user) throw new Error('You must sign in to continue.')

  let staffResult
  try {
    staffResult = await client
      .from('staff_profiles')
      .select('user_id')
      .eq('user_id', user.id)
      .maybeSingle()
  } catch (error) {
    throw withRequestContext(error, 'checking your account type')
  }
  const { data: staff, error: staffError } = staffResult
  if (staffError) throw withRequestContext(staffError, 'checking your account type')
  if (staff) {
    const error = new Error('This is a municipal staff account. Please use Municipal Staff Login.')
    error.code = 'STAFF_ACCOUNT'
    throw error
  }

  let profileResult
  try {
    profileResult = await client
      .from('profiles')
      .select('id, full_name, username')
      .eq('id', user.id)
      .maybeSingle()
  } catch (error) {
    throw withRequestContext(error, 'loading your citizen profile')
  }
  const { data: profile, error: profileError } = profileResult
  if (profileError) throw withRequestContext(profileError, 'loading your citizen profile')
  if (!profile) {
    await client.auth.signOut({ scope: 'local' })
    throw new Error('Your account is signed in, but its citizen profile is missing. Please contact an administrator to restore your profile.')
  }

  return { user, profile }
}

export async function signInCitizen({ email, password }) {
  const client = requireSupabase()
  let result
  try {
    result = await client.auth.signInWithPassword({ email, password })
  } catch (error) {
    throw withRequestContext(error, 'signing in')
  }
  const { data, error } = result
  if (error) throw error
  const identity = await getCitizenIdentity(data.user)
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
