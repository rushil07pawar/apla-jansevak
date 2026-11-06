import { requireSupabase } from './supabaseClient'
import { requireApiUrl } from './apiConfig'

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

async function signInStaffWithEndpoint({ mobile, password, endpoint, administratorOnly = false }) {
  let response
  try {
    response = await fetch(`${requireApiUrl()}${endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mobile, password }),
    })
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error('Could not reach the staff login service. Check the API URL and your network, then try again.')
    }
    throw error
  }
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || 'Unable to sign in with those credentials.')
  if (!data.session || !data.staff) throw new Error('Unable to verify this staff session.')
  if (administratorOnly &&
      (data.staff.role !== 'administrator' || data.staff.is_main_system_admin !== true)) {
    throw new Error('Unable to sign in with those credentials.')
  }

  const { error } = await requireSupabase().auth.setSession(data.session)
  if (error) throw new Error('Unable to establish your secure session.')
  return data
}

export function signInStaff({ mobile, password }) {
  return signInStaffWithEndpoint({
    mobile,
    password,
    endpoint: '/api/staff-auth/login',
  })
}

async function verifyMainAdministratorSession(accessToken) {
  let response
  try {
    response = await fetch(`${requireApiUrl()}/api/staff-auth/admin-login`, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}` },
    })
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error('Could not reach the administrator authorization service. Check the API URL and your network, then try again.')
    }
    throw error
  }
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || 'Unable to verify Main System Administrator access.')
  if (data.staff?.role !== 'administrator' || data.staff?.is_main_system_admin !== true) {
    throw new Error('Unable to verify Main System Administrator access.')
  }
  return data
}

export async function signInMainAdministrator({ email, password }) {
  let result
  try {
    result = await requireSupabase().auth.signInWithPassword({ email, password })
  } catch (error) {
    throw withRequestContext(error, 'signing in to the administrator account')
  }
  const { data, error } = result
  if (error) throw error
  try {
    const verification = await verifyMainAdministratorSession(data.session.access_token)
    return { ...data, ...verification }
  } catch (error) {
    await requireSupabase().auth.signOut({ scope: 'local' })
    throw error
  }
}

export async function getMainAdministratorSetupStatus() {
  let response
  try {
    response = await fetch(`${requireApiUrl()}/api/staff-auth/admin-setup/status`)
  } catch (error) {
    if (error.code === 'API_URL_MISSING') throw error
    if (error instanceof TypeError) {
      const apiError = new Error('Could not reach the application API. Check VITE_API_URL, the Render service, and its CORS frontend URL.')
      apiError.code = 'API_UNREACHABLE'
      throw apiError
    }
    throw error
  }
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.message || 'Unable to check initial administrator setup.')
    error.code = data.reason || 'API_REQUEST_FAILED'
    throw error
  }
  return data
}

export async function setupMainAdministrator(values) {
  const client = requireSupabase()
  let authResult
  try {
    authResult = await client.auth.signInWithPassword({
      email: values.email,
      password: values.password,
    })
  } catch (error) {
    throw withRequestContext(error, 'verifying the citizen account to promote')
  }
  const { data: authData, error: authError } = authResult
  if (authError) throw authError
  if (!authData.session?.access_token) {
    throw new Error('The citizen account did not provide a verified sign-in session.')
  }

  let response
  try {
    response = await fetch(`${requireApiUrl()}/api/staff-auth/admin-promote`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${authData.session.access_token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ setupKey: values.setupKey }),
    })
  } catch (error) {
    if (error.code === 'API_URL_MISSING') throw error
    if (error instanceof TypeError) {
      const apiError = new Error('Could not reach the application API. Check VITE_API_URL, the Render service, and its CORS frontend URL.')
      apiError.code = 'API_UNREACHABLE'
      throw apiError
    }
    throw error
  }
  const responseData = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(responseData.message || 'Unable to complete initial administrator setup.')
    error.status = response.status
    error.code = responseData.code || 'API_REQUEST_FAILED'
    throw error
  }
  return responseData
}
