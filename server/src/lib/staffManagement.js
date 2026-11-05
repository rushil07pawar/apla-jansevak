import { randomBytes } from 'node:crypto'
import { normalizeIndianMobile, staffAuthConfig, startPhoneRecovery } from './staffAuth.js'

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

export async function listWards(config) {
  const query = new URLSearchParams({
    select: 'id,ward_number,ward_name,is_active',
    order: 'ward_number.asc',
  })
  return request(config, `/rest/v1/wards?${query}`)
}

export async function listStaffDirectory(config) {
  const staffQuery = new URLSearchParams({
    select: 'user_id,staff_id,full_name_mr,full_name_en,designation_mr,designation_en,department_id,mobile_e164,official_contact_number,role,active,approved,force_password_change,profile_verified,is_main_system_admin,updated_at,department:departments(id,code,name,name_mr)',
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

function validateProfile(input) {
  const mobile = normalizeIndianMobile(input?.mobile_e164)
  const departmentId = typeof input?.department_id === 'string' ? input.department_id : ''
  const role = ['staff', 'supervisor', 'administrator'].includes(input?.role) ? input.role : ''
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
      (!profile.designation_mr && !profile.designation_en) ||
      profile.staff_id.length > 80 ||
      Object.values(profile).some(value => value.length > 180) ||
      typeof (input?.active ?? true) !== 'boolean' ||
      typeof (input?.profile_verified ?? false) !== 'boolean' ||
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

async function createAuthUser(config, mobile) {
  return request(config, '/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({
      phone: mobile,
      phone_confirm: true,
      password: randomBytes(48).toString('base64url'),
      app_metadata: { account_type: 'staff' },
    }),
  })
}

async function deleteAuthUser(config, userId) {
  return request(config, `/auth/v1/admin/users/${encodeURIComponent(userId)}`, { method: 'DELETE' })
}

export async function createStaffAccount(config, actorId, input) {
  const normalized = validateProfile(input)
  const authUser = await createAuthUser(config, normalized.profile.mobile_e164)
  if (!authUser?.id) throw new Error('Supabase Auth did not return the new staff user ID.')
  try {
    const profile = await manageStaff(config, actorId, 'upsert', authUser.id, normalized)
    if (!normalized.profile.active || !normalized.profile.approved) {
      return {
        profile,
        recoverySent: false,
        recoveryMessage: 'The account remains unavailable until its directory details are verified and approved.',
      }
    }
    let recoverySent = false
    try {
      await startPhoneRecovery(config, normalized.profile.mobile_e164)
      recoverySent = true
    } catch (error) {
      return { profile, recoverySent, recoveryMessage: error.message }
    }
    return { profile, recoverySent }
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
  const normalized = validateProfile(input)
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
    if (!mobileChanged) return { profile, recoverySent: null }
    if (!normalized.profile.active || !normalized.profile.approved) {
      return {
        profile,
        recoverySent: false,
        recoveryMessage: 'No setup code was sent because the profile is inactive or unapproved.',
      }
    }
    try {
      await startPhoneRecovery(config, normalized.profile.mobile_e164)
      return { profile, recoverySent: true }
    } catch (error) {
      return { profile, recoverySent: false, recoveryMessage: error.message }
    }
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

export async function requestStaffCredentialReset(config, staffUserId) {
  if (!UUID_PATTERN.test(staffUserId)) {
    const error = new Error('Invalid staff user ID.')
    error.status = 400
    throw error
  }
  const query = new URLSearchParams({
    select: 'user_id,mobile_e164,active,approved',
    user_id: `eq.${staffUserId}`,
    limit: '1',
  })
  const [staff] = await request(config, `/rest/v1/staff_profiles?${query}`)
  if (!staff?.active || !staff?.approved) {
    const error = new Error('Only active, approved staff accounts can receive a reset code.')
    error.status = 400
    throw error
  }
  await startPhoneRecovery(config, staff.mobile_e164)
}

export async function recordPasswordResetRequest(config, actorId, staffUserId) {
  await request(config, '/rest/v1/rpc/audit_staff_password_reset_request', {
    method: 'POST',
    body: JSON.stringify({ p_actor: actorId, p_staff_user_id: staffUserId }),
  })
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
    select: 'user_id,department_id,role,active,approved,force_password_change,is_main_system_admin',
    user_id: `eq.${user.id}`,
    limit: '1',
  })
  const [staff] = await request(config, `/rest/v1/staff_profiles?${query}`)
  if (!staff?.active || !staff?.approved || staff.force_password_change) {
    const error = new Error('This staff account is inactive, unapproved, or must reset its password.')
    error.status = 403
    throw error
  }
  return { config, userId: user.id, staff }
}

export async function getStaffDashboard(config, userId, staff) {
  let scopes = []
  let permissions = new Set()
  let staffOptions = []
  let departments = []
  let wards = []
  if (staff.is_main_system_admin) {
    const [allDepartments, allWards] = await Promise.all([listDepartments(config), listWards(config)])
    departments = allDepartments
    wards = allWards
    scopes = departments.flatMap(department =>
      wards.filter(ward => ward.is_active).map(ward => ({
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
  const dashboardStaff = {
    ...staff,
    user_id: userId,
    canUpdate: permissions.has('complaints.update'),
    canAssign: permissions.has('complaints.assign'),
    canEscalate: permissions.has('complaints.escalate'),
    canRoute: Boolean(staff.is_main_system_admin),
    managerId,
  }
  if (!scopes.length) return { staff: dashboardStaff, complaints: [], staffOptions, departments, wards, stats: emptyStats() }

  const filters = staff.is_main_system_admin
    ? [`department_id.in.(${departments.map(department => department.id).join(',')})`, 'department_id.is.null']
    : scopes.map(scope => `and(department_id.eq.${scope.department_id},ward_id.eq.${scope.ward_id})`)
  const filter = `(${filters.join(',')})`
  const complaintQuery = new URLSearchParams({
    select: 'id,department_id,ward_id,title,description,category,severity,status,latitude,longitude,photo_path,created_at,updated_at',
    or: filter,
    order: 'created_at.desc',
    limit: '500',
  })
  const complaints = await request(config, `/rest/v1/complaints?${complaintQuery}`)
  if (!complaints.length) return { staff: dashboardStaff, complaints, staffOptions, departments, wards, stats: emptyStats() }
  const ids = `in.(${complaints.map(complaint => complaint.id).join(',')})`
  const [assignments, history] = await Promise.all([
    request(config, `/rest/v1/complaint_assignments?${new URLSearchParams({ select: 'complaint_id,staff_user_id,assigned_by,assigned_at,unassigned_at', complaint_id: ids, order: 'assigned_at.desc' })}`),
    request(config, `/rest/v1/complaint_status_history?${new URLSearchParams({ select: 'complaint_id,previous_status,new_status,note,changed_by,event_type,previous_assignee_id,new_assignee_id,details,created_at', complaint_id: ids, order: 'created_at.desc' })}`),
  ])
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
