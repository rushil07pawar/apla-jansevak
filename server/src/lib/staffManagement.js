import { normalizeIndianMobile, staffAuthConfig } from './staffAuth.js'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function headers(config, token) {
  return {
    apikey: config.secretKey,
    authorization: `Bearer ${config.secretKey}`,
    'content-type': 'application/json',
    ...(token ? { 'x-user-token': token } : {}),
  }
}

async function request(config, path, options = {}) {
  const response = await fetch(`${config.url}${path}`, {
    ...options,
    headers: { ...headers(config), ...options.headers },
  })
  const text = await response.text()
  let data
  try { data = text ? JSON.parse(text) : null } catch { data = null }
  if (!response.ok) {
    const error = new Error(data?.message || data?.msg || `Supabase request failed (${response.status}).`)
    error.status = response.status
    throw error
  }
  return data
}

export async function authorizeMainAdministrator(req) {
  const config = staffAuthConfig()
  const token = req.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!config || !token) {
    const error = new Error('Sign in with an authorized municipal administrator account.')
    error.status = 401
    throw error
  }

  const userResponse = await fetch(`${config.url}/auth/v1/user`, {
    headers: { apikey: config.publishableKey, authorization: `Bearer ${token}` },
  })
  if (!userResponse.ok) {
    const error = new Error('Your session is invalid or expired.')
    error.status = 401
    throw error
  }
  const user = await userResponse.json()
  const query = new URLSearchParams({
    select: 'user_id,role,active,approved,force_password_change,is_main_system_admin',
    user_id: `eq.${user.id}`,
    limit: '1',
  })
  const [staff] = await request(config, `/rest/v1/staff_profiles?${query}`)
  if (!staff?.is_main_system_admin || staff.role !== 'administrator' ||
      !staff.active || !staff.approved || staff.force_password_change) {
    const error = new Error('Main System Administrator authorization is required.')
    error.status = 403
    throw error
  }
  return { config, userId: user.id }
}

export async function listDepartments(config) {
  const query = new URLSearchParams({
    select: 'id,code,name,name_mr',
    order: 'name.asc',
  })
  return request(config, `/rest/v1/departments?${query}`)
}

export async function manageDepartment(config, actorId, action, input = {}, departmentId = null) {
  const code = typeof input.code === 'string' ? input.code.trim().toUpperCase() : ''
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  const nameMr = typeof input.name_mr === 'string' ? input.name_mr.trim() : ''
  if (!['create', 'update'].includes(action) ||
      (departmentId !== null && !UUID_PATTERN.test(departmentId)) ||
      (action === 'update' && !departmentId) ||
      !/^[A-Z0-9_]{2,32}$/.test(code) ||
      name.length < 2 || name.length > 120 || nameMr.length > 180) {
    const error = new Error('Provide a valid department code, English name, and optional Marathi name.')
    error.status = 400
    throw error
  }
  return request(config, '/rest/v1/rpc/manage_department', {
    method: 'POST',
    body: JSON.stringify({
      p_actor: actorId,
      p_action: action,
      p_department_id: departmentId,
      p_code: code,
      p_name: name,
      p_name_mr: nameMr || null,
    }),
  })
}

export async function listSystemSettings(config) {
  const query = new URLSearchParams({
    select: 'key,value,description,updated_at,updated_by',
    order: 'key.asc',
  })
  return request(config, `/rest/v1/system_settings?${query}`)
}

export async function manageSystemSetting(config, actorId, action, key, value, description) {
  if (typeof key !== 'string' || !/^[a-z][a-z0-9_.-]{0,99}$/.test(key) ||
      !['upsert', 'delete'].includes(action)) {
    const error = new Error('Provide a valid system setting key and action.')
    error.status = 400
    throw error
  }
  if (action === 'upsert') {
    let serialized
    try {
      serialized = JSON.stringify(value)
    } catch {
      serialized = undefined
    }
    if (serialized === undefined || serialized.length > 65536 ||
        (description !== null && description !== undefined &&
          (typeof description !== 'string' || description.trim().length > 500))) {
      const error = new Error('Provide a JSON value up to 64 KiB and a description up to 500 characters.')
      error.status = 400
      throw error
    }
  }
  return request(config, '/rest/v1/rpc/manage_system_setting', {
    method: 'POST',
    body: JSON.stringify({
      p_actor: actorId,
      p_action: action,
      p_key: key,
      p_value: action === 'upsert' ? value : null,
      p_description: action === 'upsert' ? (description?.trim() || null) : null,
    }),
  })
}

export async function listWards(config) {
  const query = new URLSearchParams({
    select: 'id,ward_number,ward_name,is_active',
    order: 'ward_number.asc',
  })
  return request(config, `/rest/v1/wards?${query}`)
}

export async function listStaffDesignations(config) {
  const query = new URLSearchParams({
    select: 'id,department_id,name_mr,name_en,is_active,created_at,updated_at',
    order: 'department_id.asc,name_en.asc',
  })
  return request(config, `/rest/v1/staff_designations?${query}`)
}

export async function manageStaffDesignation(config, actorId, action, input = {}, designationId = null) {
  if (!['create', 'update', 'set_active'].includes(action) ||
      (designationId !== null && !UUID_PATTERN.test(designationId)) ||
      (action !== 'create' && !designationId)) {
    const error = new Error('Invalid staff designation request.')
    error.status = 400
    throw error
  }
  const departmentId = typeof input.department_id === 'string' ? input.department_id : ''
  const nameMr = typeof input.name_mr === 'string' ? input.name_mr.trim() : ''
  const nameEn = typeof input.name_en === 'string' ? input.name_en.trim() : ''
  const active = input.is_active !== false
  if ((action === 'create' || action === 'update') &&
      (!UUID_PATTERN.test(departmentId) || (!nameMr && !nameEn) ||
       nameMr.length > 180 || nameEn.length > 180)) {
    const error = new Error('Choose a department and enter a Marathi or English designation up to 180 characters.')
    error.status = 400
    throw error
  }
  if (action === 'set_active' && typeof input.is_active !== 'boolean') {
    const error = new Error('Choose whether this designation should be active.')
    error.status = 400
    throw error
  }
  return request(config, '/rest/v1/rpc/manage_staff_designation', {
    method: 'POST',
    body: JSON.stringify({
      p_actor: actorId,
      p_action: action,
      p_designation_id: designationId,
      p_department_id: departmentId || null,
      p_name_mr: nameMr || null,
      p_name_en: nameEn || null,
      p_is_active: active,
    }),
  })
}

export async function listStaffDirectory(config) {
  const staffQuery = new URLSearchParams({
    select: 'user_id,staff_id,full_name_mr,full_name_en,designation_id,designation_mr,designation_en,department_id,mobile_e164,official_contact_number,role,active,approved,force_password_change,profile_verified,is_main_system_admin,updated_at,department:departments(id,code,name,name_mr)',
    order: 'department_id.asc,staff_id.asc',
  })
  const staff = await request(config, `/rest/v1/staff_profiles?${staffQuery}`)
  if (!staff.length) return []

  const userIds = staff.map(row => row.user_id)
  const inFilter = `in.(${userIds.join(',')})`
  const [assignments, hierarchy, permissions] = await Promise.all([
    request(config, `/rest/v1/staff_ward_assignments?${new URLSearchParams({ select: 'staff_user_id,ward_id,ward:wards(id,ward_number,ward_name,is_active)', staff_user_id: inFilter })}`),
    request(config, `/rest/v1/staff_hierarchy?${new URLSearchParams({ select: 'staff_user_id,reports_to_user_id', staff_user_id: inFilter })}`),
    request(config, `/rest/v1/staff_permissions?${new URLSearchParams({ select: 'staff_user_id,permission_code,department_id,ward_id', staff_user_id: inFilter })}`),
  ])
  return staff.map(row => ({
    ...row,
    wards: assignments.filter(item => item.staff_user_id === row.user_id).map(item => item.ward),
    reports_to_user_id: hierarchy.find(item => item.staff_user_id === row.user_id)?.reports_to_user_id || null,
    permissions: permissions.filter(item => item.staff_user_id === row.user_id),
  }))
}

async function validateProfile(config, input, { requireDesignation = false } = {}) {
  const mobile = normalizeIndianMobile(input?.mobile_e164)
  const departmentId = typeof input?.department_id === 'string' ? input.department_id : ''
  const allRoles = [
    'staff',
    'supervisor',
    'administrator',
    'department_head',
    'supervising_officer',
    'junior_section_officer',
    'assigned_staff',
  ]
  const creatableRoles = ['department_head', 'supervising_officer', 'junior_section_officer', 'assigned_staff']
  const role = (requireDesignation ? creatableRoles : allRoles).includes(input?.role) ? input.role : ''
  const designationId = typeof input?.designation_id === 'string' ? input.designation_id : ''
  const textFields = ['staff_id', 'full_name_mr', 'full_name_en', 'designation_mr', 'designation_en']
  const profile = Object.fromEntries(textFields.map(field => [
    field,
    typeof input?.[field] === 'string' ? input[field].trim() : '',
  ]))
  const officialContact = input?.official_contact_number
    ? normalizeIndianMobile(input.official_contact_number)
    : mobile
  const rawWards = input?.ward_ids ?? []
  const rawPermissions = input?.permissions ?? []
  const rawReportsTo = input?.reports_to_user_id ?? ''
  if (!mobile || !UUID_PATTERN.test(departmentId) || !role ||
      !officialContact ||
      (!profile.full_name_mr && !profile.full_name_en) ||
      (!designationId && !profile.designation_mr && !profile.designation_en) ||
      profile.staff_id.length > 80 ||
      Object.values(profile).some(value => value.length > 180) ||
      typeof (input?.active ?? true) !== 'boolean' ||
      typeof (input?.profile_verified ?? false) !== 'boolean' ||
      (designationId !== '' && !UUID_PATTERN.test(designationId)) ||
      (requireDesignation && !designationId) ||
      !Array.isArray(rawWards) ||
      rawWards.some(id => typeof id !== 'string' || !UUID_PATTERN.test(id)) ||
      !Array.isArray(rawPermissions) ||
      rawPermissions.some(item =>
        !item ||
        !['complaints.read', 'complaints.update', 'complaints.assign', 'complaints.escalate'].includes(item.permission_code) ||
        typeof item.ward_id !== 'string' ||
        !UUID_PATTERN.test(item.ward_id) ||
        !rawWards.includes(item.ward_id),
      ) ||
      (rawReportsTo !== '' && (typeof rawReportsTo !== 'string' || !UUID_PATTERN.test(rawReportsTo)))) {
    const error = new Error('Enter a valid mobile number, department, name, designation, and role.')
    error.status = 400
    throw error
  }
  if (designationId) {
    const designationQuery = new URLSearchParams({
      select: 'id,department_id,name_mr,name_en,is_active',
      id: `eq.${designationId}`,
      department_id: `eq.${departmentId}`,
      is_active: 'eq.true',
      limit: '1',
    })
    const [designation] = await request(config, `/rest/v1/staff_designations?${designationQuery}`)
    if (!designation) {
      const error = new Error('Select an active designation configured for this department.')
      error.status = 400
      throw error
    }
    profile.designation_mr = designation.name_mr || ''
    profile.designation_en = designation.name_en || ''
  }
  const wards = [...new Set(rawWards)]
  if (rawPermissions.some((item, index) =>
    rawPermissions.findIndex(other => other.permission_code === item.permission_code && other.ward_id === item.ward_id) !== index,
  )) {
    const error = new Error('A permission can only be assigned once per ward.')
    error.status = 400
    throw error
  }
  const permissions = rawPermissions.map(item => ({ permission_code: item.permission_code, ward_id: item.ward_id }))
  const reportsTo = rawReportsTo || null
  const profileVerified = input?.profile_verified === true
  return {
    profile: {
      ...profile,
      department_id: departmentId,
      designation_id: designationId || null,
      mobile_e164: mobile,
      official_contact_number: officialContact,
      role,
      active: input?.active !== false,
      approved: input?.active !== false && profileVerified,
      profile_verified: profileVerified,
    },
    wardIds: wards,
    permissions,
    reportsTo,
  }
}

async function manageStaff(config, actorId, action, staffUserId, data = {}) {
  return request(config, '/rest/v1/rpc/manage_staff_directory', {
    method: 'POST',
    body: JSON.stringify({
      p_actor: actorId,
      p_action: action,
      p_staff_user_id: staffUserId,
      p_profile: data.profile || {},
      p_ward_ids: data.wardIds || [],
      p_permissions: data.permissions || [],
      p_reports_to_user_id: data.reportsTo || null,
    }),
  })
}

async function saveStaffDesignation(config, staffUserId, designationId) {
  const query = new URLSearchParams({ user_id: `eq.${staffUserId}` })
  const response = await fetch(`${config.url}/rest/v1/staff_profiles?${query}`, {
    method: 'PATCH',
    headers: { ...headers(config), prefer: 'return=representation' },
    body: JSON.stringify({ designation_id: designationId }),
  })
  if (!response.ok) {
    const error = new Error('Staff profile was saved, but its configured designation could not be linked.')
    error.status = 502
    throw error
  }
  const [profile] = await response.json()
  if (!profile || profile.designation_id !== designationId) {
    const error = new Error('The configured designation changed during save. Verify the staff profile before continuing.')
    error.status = 409
    throw error
  }
}

function validateStaffPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
    const error = new Error('Set a staff password between 12 and 128 characters.')
    error.status = 400
    throw error
  }
  return password
}

async function createAuthUser(config, mobile, password) {
  return request(config, '/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({
      phone: mobile,
      phone_confirm: true,
      password,
      app_metadata: { account_type: 'staff' },
    }),
  })
}

async function deleteAuthUser(config, userId) {
  return request(config, `/auth/v1/admin/users/${encodeURIComponent(userId)}`, { method: 'DELETE' })
}

export async function createStaffAccount(config, actorId, input) {
  const normalized = await validateProfile(config, input, { requireDesignation: true })
  const password = validateStaffPassword(input?.password)
  const authUser = await createAuthUser(config, normalized.profile.mobile_e164, password)
  if (!authUser?.id) throw new Error('Supabase Auth did not return the new staff user ID.')
  try {
    const profile = await manageStaff(config, actorId, 'upsert', authUser.id, normalized)
    await saveStaffDesignation(config, authUser.id, normalized.profile.designation_id)
    await recordStaffPasswordSet(config, actorId, authUser.id)
    return { profile }
  } catch (error) {
    try { await deleteAuthUser(config, authUser.id) } catch (cleanupError) {
      error.cleanupError = cleanupError.message
    }
    throw error
  }
}

export async function updateStaffAccount(config, actorId, staffUserId, input) {
  if (!UUID_PATTERN.test(staffUserId)) {
    const error = new Error('Invalid staff user ID.')
    error.status = 400
    throw error
  }
  const normalized = await validateProfile(config, input)
  const query = new URLSearchParams({
    select: 'user_id,mobile_e164',
    user_id: `eq.${staffUserId}`,
    limit: '1',
  })
  const [existing] = await request(config, `/rest/v1/staff_profiles?${query}`)
  if (!existing) {
    const error = new Error('Staff profile not found.')
    error.status = 404
    throw error
  }
  const mobileChanged = existing.mobile_e164 !== normalized.profile.mobile_e164
  if (mobileChanged) {
    await request(config, `/auth/v1/admin/users/${encodeURIComponent(staffUserId)}`, {
      method: 'PUT',
      body: JSON.stringify({ phone: normalized.profile.mobile_e164, phone_confirm: true }),
    })
  }
  try {
    const profile = await manageStaff(config, actorId, 'upsert', staffUserId, normalized)
    await saveStaffDesignation(config, staffUserId, normalized.profile.designation_id)
    if (mobileChanged) await recordStaffPasswordSet(config, actorId, staffUserId)
    return { profile }
  } catch (error) {
    if (mobileChanged) {
      try {
        await request(config, `/auth/v1/admin/users/${encodeURIComponent(staffUserId)}`, {
          method: 'PUT',
          body: JSON.stringify({ phone: existing.mobile_e164, phone_confirm: true }),
        })
      } catch (rollbackError) {
        error.rollbackError = rollbackError.message
      }
    }
    throw error
  }
}

export async function setStaffActive(config, actorId, staffUserId, active) {
  if (!UUID_PATTERN.test(staffUserId) || typeof active !== 'boolean') {
    const error = new Error('Invalid staff account status request.')
    error.status = 400
    throw error
  }
  return manageStaff(config, actorId, 'set_active', staffUserId, { profile: { active } })
}

export async function setStaffPassword(config, actorId, staffUserId, password) {
  if (!UUID_PATTERN.test(staffUserId)) {
    const error = new Error('Invalid staff user ID.')
    error.status = 400
    throw error
  }
  validateStaffPassword(password)
  const query = new URLSearchParams({ select: 'user_id', user_id: `eq.${staffUserId}`, limit: '1' })
  const [staff] = await request(config, `/rest/v1/staff_profiles?${query}`)
  if (!staff) {
    const error = new Error('Staff profile not found.')
    error.status = 404
    throw error
  }
  await request(config, `/auth/v1/admin/users/${encodeURIComponent(staffUserId)}`, {
    method: 'PUT',
    body: JSON.stringify({ password }),
  })
  await recordStaffPasswordSet(config, actorId, staffUserId)
}

async function recordStaffPasswordSet(config, actorId, staffUserId) {
  try {
    await request(config, '/rest/v1/rpc/set_staff_password_ready', {
      method: 'POST',
      body: JSON.stringify({ p_actor: actorId, p_staff_user_id: staffUserId }),
    })
  } catch (error) {
    if (error.status === 404) {
      error.message = 'Password was saved, but the password-audit migration is not applied. Apply 20261106_004_admin_managed_staff_passwords.sql and retry the password setup.'
    }
    throw error
  }
}

async function authenticatedUser(config, token) {
  const response = await fetch(`${config.url}/auth/v1/user`, {
    headers: { apikey: config.publishableKey, authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    const error = new Error('Your session is invalid or expired.')
    error.status = 401
    throw error
  }
  return response.json()
}

export async function authorizeStaffSession(req) {
  const config = staffAuthConfig()
  const token = req.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!config || !token) {
    const error = new Error('Sign in with an authorized municipal staff account.')
    error.status = 401
    throw error
  }
  const user = await authenticatedUser(config, token)
  const query = new URLSearchParams({
    select: 'user_id,staff_id,full_name_mr,full_name_en,designation_id,designation_mr,designation_en,department_id,role,active,approved,force_password_change,is_main_system_admin',
    user_id: `eq.${user.id}`,
    limit: '1',
  })
  const [staff] = await request(config, `/rest/v1/staff_profiles?${query}`)
  if (!staff?.active || !staff?.approved || staff.force_password_change) {
    const error = new Error('This staff account is inactive, unapproved, or must reset its password.')
    error.status = 403
    throw error
  }
  if (staff.is_main_system_admin && staff.role !== 'administrator') {
    const error = new Error('The Main System Administrator profile is invalid. Contact the system owner.')
    error.status = 403
    throw error
  }
  return { config, userId: user.id, staff }
}

export async function getStaffDashboard(config, userId, staff) {
  const isMainAdministrator = staff.is_main_system_admin === true &&
    staff.role === 'administrator' &&
    staff.active &&
    staff.approved &&
    !staff.force_password_change
  let scopes = []
  let permissions = new Set()
  let staffOptions = []
  let departments = []
  let wards = []
  if (isMainAdministrator) {
    const [allDepartments, allWards] = await Promise.all([listDepartments(config), listWards(config)])
    departments = allDepartments
    wards = allWards
    scopes = departments.flatMap(department =>
      wards.map(ward => ({
        department_id: department.id,
        ward_id: ward.id,
      })),
    )
    permissions = new Set(['complaints.update', 'complaints.assign', 'complaints.escalate'])
    staffOptions = await request(config, '/rest/v1/staff_profiles?select=user_id,staff_id,full_name_mr,full_name_en,designation_mr,designation_en&active=eq.true&approved=eq.true&force_password_change=eq.false')
    if (staffOptions.length) {
      const optionIds = `in.(${staffOptions.map(option => option.user_id).join(',')})`
      const wardRows = await request(config, `/rest/v1/staff_ward_assignments?${new URLSearchParams({ select: 'staff_user_id,ward_id', staff_user_id: optionIds })}`)
      staffOptions = staffOptions.map(option => ({
        ...option,
        ward_ids: wardRows.filter(row => row.staff_user_id === option.user_id).map(row => row.ward_id),
      }))
    }
  } else {
    departments = await listDepartments(config)
    const query = new URLSearchParams({
      select: 'department_id,ward_id,permission_code',
      staff_user_id: `eq.${userId}`,
      permission_code: 'eq.complaints.read',
    })
    scopes = await request(config, `/rest/v1/staff_permissions?${query}`)
    scopes = scopes.filter(scope => scope.department_id === staff.department_id)
    const assignedRows = await request(config, `/rest/v1/staff_ward_assignments?${new URLSearchParams({
      select: 'ward_id',
      staff_user_id: `eq.${userId}`,
    })}`)
    const assignedWardIds = new Set(assignedRows.map(row => row.ward_id))
    const wardIds = [...new Set(scopes.map(scope => scope.ward_id).filter(id => assignedWardIds.has(id)))]
    if (wardIds.length) {
      const wardQuery = new URLSearchParams({
        select: 'id,ward_number,ward_name',
        id: `in.(${wardIds.join(',')})`,
        is_active: 'eq.true',
      })
      wards = await request(config, `/rest/v1/wards?${wardQuery}`)
      const activeWardIds = new Set(wards.map(ward => ward.id))
      scopes = scopes.filter(scope => activeWardIds.has(scope.ward_id) && assignedWardIds.has(scope.ward_id))
    } else {
      scopes = []
    }
    const allPermissionQuery = new URLSearchParams({
      select: 'permission_code',
      staff_user_id: `eq.${userId}`,
      department_id: `eq.${staff.department_id}`,
    })
    const staffPermissions = await request(config, `/rest/v1/staff_permissions?${allPermissionQuery}`)
    permissions = new Set(staffPermissions.map(permission => permission.permission_code))

    if (permissions.has('complaints.assign')) {
      const departmentStaffQuery = new URLSearchParams({
        select: 'user_id,staff_id,full_name_mr,full_name_en,designation_mr,designation_en',
        department_id: `eq.${staff.department_id}`,
        active: 'eq.true',
        approved: 'eq.true',
        force_password_change: 'eq.false',
      })
      staffOptions = await request(config, `/rest/v1/staff_profiles?${departmentStaffQuery}`)
      if (staffOptions.length) {
        const optionIds = `in.(${staffOptions.map(option => option.user_id).join(',')})`
        const wardRows = await request(config, `/rest/v1/staff_ward_assignments?${new URLSearchParams({ select: 'staff_user_id,ward_id', staff_user_id: optionIds })}`)
        staffOptions = staffOptions.map(option => ({
          ...option,
          ward_ids: wardRows.filter(row => row.staff_user_id === option.user_id).map(row => row.ward_id),
        }))
      }
    }
  }
  const managerRows = await request(config, `/rest/v1/staff_hierarchy?${new URLSearchParams({ select: 'reports_to_user_id', staff_user_id: `eq.${userId}`, limit: '1' })}`)
  const managerId = managerRows[0]?.reports_to_user_id || null
  let reportsTo = null
  if (managerId) {
    const managerQuery = new URLSearchParams({
      select: 'user_id,staff_id,full_name_mr,full_name_en,designation_mr,designation_en',
      user_id: `eq.${managerId}`,
      limit: '1',
    })
    const managerProfiles = await request(config, `/rest/v1/staff_profiles?${managerQuery}`)
    reportsTo = managerProfiles[0] || null
  }
  const dashboardStaff = {
    ...staff,
    user_id: userId,
    is_main_system_admin: isMainAdministrator,
    authorized_wards: wards,
    ward_permissions: [...permissions],
    canUpdate: permissions.has('complaints.update'),
    canAssign: permissions.has('complaints.assign'),
    canEscalate: permissions.has('complaints.escalate'),
    canRoute: isMainAdministrator,
    managerId,
    reportsTo,
  }
  const assignedOnlyRoles = ['staff', 'assigned_staff', 'junior_section_officer']
  let assignedComplaintIds = null
  if (!isMainAdministrator && assignedOnlyRoles.includes(staff.role)) {
    const assignedRows = await request(config, `/rest/v1/complaint_assignments?${new URLSearchParams({
      select: 'complaint_id',
      staff_user_id: `eq.${userId}`,
      unassigned_at: 'is.null',
    })}`)
    assignedComplaintIds = [...new Set(assignedRows.map(row => row.complaint_id))]
    if (!assignedComplaintIds.length) {
      return { staff: dashboardStaff, complaints: [], staffOptions, departments, wards, stats: emptyStats() }
    }
  }
  if (!scopes.length && !isMainAdministrator) {
    return { staff: dashboardStaff, complaints: [], staffOptions, departments, wards, stats: emptyStats() }
  }

  const filters = isMainAdministrator
    ? [`department_id.in.(${departments.map(department => department.id).join(',')})`, 'department_id.is.null']
    : scopes.map(scope => `and(department_id.eq.${scope.department_id},ward_id.eq.${scope.ward_id})`)
  const filter = `(${filters.join(',')})`
  const complaintQuery = new URLSearchParams({
    select: 'id,department_id,ward_id,title,description,category,severity,status,latitude,longitude,photo_path,created_at,updated_at',
    or: filter,
    order: 'created_at.desc',
    limit: '500',
  })
  if (assignedComplaintIds) complaintQuery.set('id', `in.(${assignedComplaintIds.join(',')})`)
  const complaintPath = `/rest/v1/complaints?${complaintQuery}`
  const complaints = isMainAdministrator
    ? await listAllPages(config, complaintPath)
    : await request(config, complaintPath)
  if (!complaints.length) return { staff: dashboardStaff, complaints, staffOptions, departments, wards, stats: emptyStats() }
  const complaintBatches = []
  for (let index = 0; index < complaints.length; index += 200) {
    complaintBatches.push(complaints.slice(index, index + 200))
  }
  const relatedRows = await Promise.all(complaintBatches.map(async batch => {
    const ids = `in.(${batch.map(complaint => complaint.id).join(',')})`
    const [assignments, history] = await Promise.all([
      request(config, `/rest/v1/complaint_assignments?${new URLSearchParams({ select: 'complaint_id,staff_user_id,assigned_by,assigned_at,unassigned_at', complaint_id: ids, order: 'assigned_at.desc' })}`),
      request(config, `/rest/v1/complaint_status_history?${new URLSearchParams({ select: 'complaint_id,previous_status,new_status,note,changed_by,event_type,previous_assignee_id,new_assignee_id,details,created_at', complaint_id: ids, order: 'created_at.desc' })}`),
    ])
    return { assignments, history }
  }))
  const assignments = relatedRows.flatMap(rows => rows.assignments)
  const history = relatedRows.flatMap(rows => rows.history)
  const relatedStaffIds = [...new Set([
    ...assignments.map(row => row.staff_user_id),
    ...assignments.map(row => row.assigned_by),
    ...history.map(row => row.changed_by).filter(Boolean),
    ...history.map(row => row.previous_assignee_id).filter(Boolean),
    ...history.map(row => row.new_assignee_id).filter(Boolean),
  ])]
  let relatedStaff = []
  if (relatedStaffIds.length) {
    const staffFilter = `in.(${relatedStaffIds.join(',')})`
    relatedStaff = await request(config, `/rest/v1/staff_profiles?${new URLSearchParams({
      select: 'user_id,staff_id,full_name_mr,full_name_en,designation_mr,designation_en',
      user_id: staffFilter,
    })}`)
  }
  const staffById = new Map(relatedStaff.map(row => [row.user_id, row]))
  const enriched = complaints.map(complaint => ({
    ...complaint,
    assignments: assignments.filter(row => row.complaint_id === complaint.id).map(row => ({
      ...row,
      staff: staffById.get(row.staff_user_id) || null,
      assigner: staffById.get(row.assigned_by) || null,
    })),
    history: history.filter(row => row.complaint_id === complaint.id).map(row => ({
      ...row,
      actor: staffById.get(row.changed_by) || null,
      previousAssignee: staffById.get(row.previous_assignee_id) || null,
      newAssignee: staffById.get(row.new_assignee_id) || null,
    })),
    staffOptions: staffOptions.filter(option => option.ward_ids?.includes(complaint.ward_id)),
  }))
  const stats = enriched.reduce((counts, complaint) => {
    counts.total += 1
    counts[complaint.status] = (counts[complaint.status] || 0) + 1
    if (complaint.assignments.some(row => row.staff_user_id === userId && !row.unassigned_at)) {
      counts.assigned += 1
    }
    if (complaint.status !== 'resolved' && complaint.status !== 'closed' && complaint.status !== 'rejected') {
      counts.pending += 1
    }
    return counts
  }, emptyStats())
  return { staff: dashboardStaff, complaints: enriched, staffOptions, departments, wards, stats }
}

async function listAllPages(config, path, pageSize = 500) {
  const rows = []
  for (let offset = 0; ; offset += pageSize) {
    const page = await request(config, path, {
      headers: { range: `${offset}-${offset + pageSize - 1}` },
    })
    if (!Array.isArray(page)) {
      throw new Error('Supabase returned an invalid complaint page.')
    }
    rows.push(...page)
    if (page.length < pageSize) return rows
  }
}

function emptyStats() {
  return { total: 0, assigned: 0, pending: 0, submitted: 0, acknowledged: 0, in_progress: 0, resolved: 0, closed: 0, rejected: 0 }
}

export async function manageComplaint(config, actorId, complaintId, input) {
  if (!UUID_PATTERN.test(complaintId) ||
      !['status', 'assign', 'escalate', 'route'].includes(input?.action)) {
    const error = new Error('Invalid complaint action.')
    error.status = 400
    throw error
  }
  const actorQuery = new URLSearchParams({
    select: 'role,is_main_system_admin',
    user_id: `eq.${actorId}`,
    limit: '1',
  })
  const [actor] = await request(config, `/rest/v1/staff_profiles?${actorQuery}`)
  if (!actor) {
    const error = new Error('Authorized municipal staff account required.')
    error.status = 403
    throw error
  }
  const delegatedRoles = ['department_head', 'supervising_officer', 'supervisor', 'administrator']
  if (
    !actor.is_main_system_admin &&
    ['assign', 'escalate'].includes(input.action) &&
    !delegatedRoles.includes(actor.role)
  ) {
    const error = new Error('Your staff role does not allow assigning or forwarding complaints.')
    error.status = 403
    throw error
  }
  if (
    !actor.is_main_system_admin &&
    input.action === 'status' &&
    ['staff', 'assigned_staff', 'junior_section_officer'].includes(actor.role)
  ) {
    const assignmentQuery = new URLSearchParams({
      select: 'id',
      complaint_id: `eq.${complaintId}`,
      staff_user_id: `eq.${actorId}`,
      unassigned_at: 'is.null',
      limit: '1',
    })
    const [assignment] = await request(config, `/rest/v1/complaint_assignments?${assignmentQuery}`)
    if (!assignment) {
      const error = new Error('You can update only complaints currently assigned to you.')
      error.status = 403
      throw error
    }
  }
  const assignee = typeof input.assignee_id === 'string' &&
    UUID_PATTERN.test(input.assignee_id)
    ? input.assignee_id
    : null
  const departmentId = typeof input.department_id === 'string' &&
    UUID_PATTERN.test(input.department_id)
    ? input.department_id
    : null
  return request(config, '/rest/v1/rpc/manage_complaint', {
    method: 'POST',
    body: JSON.stringify({
      p_actor: actorId,
      p_action: input.action,
      p_complaint_id: complaintId,
      p_status: input.status || null,
      p_note: typeof input.note === 'string' ? input.note.slice(0, 2000) : null,
      p_assignee_id: assignee,
      p_department_id: departmentId,
    }),
  })
}
