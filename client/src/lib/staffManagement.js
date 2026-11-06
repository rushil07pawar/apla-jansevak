import { requireSupabase } from './supabaseClient'

const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000'

async function request(path, options = {}) {
  const { data: { session }, error: sessionError } = await requireSupabase().auth.getSession()
  if (sessionError) throw sessionError
  if (!session?.access_token) throw new Error('Sign in with an authorized municipal staff account.')

  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${session.access_token}`,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...options.headers,
    },
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error([data.message, data.cleanupWarning, data.rollbackWarning].filter(Boolean).join(' '))
  }
  return data
}

export async function getStaffDashboard() {
  return request('/api/staff/dashboard')
}

export async function getAdminDashboard() {
  return request('/api/admin/dashboard')
}

export async function takeComplaintAction(complaintId, action) {
  return request(`/api/staff/complaints/${encodeURIComponent(complaintId)}/actions`, {
    method: 'POST',
    body: JSON.stringify(action),
  })
}

export async function getAdminDepartments() {
  return request('/api/admin/departments')
}

export async function createAdminDepartment(department) {
  return request('/api/admin/departments', {
    method: 'POST',
    body: JSON.stringify(department),
  })
}

export async function updateAdminDepartment(departmentId, department) {
  return request(`/api/admin/departments/${encodeURIComponent(departmentId)}`, {
    method: 'PATCH',
    body: JSON.stringify(department),
  })
}

export async function getAdminWards() {
  return request('/api/admin/wards')
}

export async function getAdminDesignations() {
  return request('/api/admin/designations')
}

export async function createStaffDesignation(designation) {
  return request('/api/admin/designations', {
    method: 'POST',
    body: JSON.stringify(designation),
  })
}

export async function updateStaffDesignation(designationId, designation) {
  return request(`/api/admin/designations/${encodeURIComponent(designationId)}`, {
    method: 'PATCH',
    body: JSON.stringify(designation),
  })
}

export async function setStaffDesignationActive(designationId, active) {
  return request(`/api/admin/designations/${encodeURIComponent(designationId)}/active`, {
    method: 'PATCH',
    body: JSON.stringify({ is_active: active }),
  })
}

export async function getAdminStaff() {
  return request('/api/admin/staff')
}

export async function getAdminAuditLogs() {
  return request('/api/admin/audit-logs')
}

export async function getAdminSystemSettings() {
  return request('/api/admin/system-settings')
}

export async function saveAdminSystemSetting(key, setting) {
  return request(`/api/admin/system-settings/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify(setting),
  })
}

export async function deleteAdminSystemSetting(key) {
  return request(`/api/admin/system-settings/${encodeURIComponent(key)}`, {
    method: 'DELETE',
  })
}

export async function createStaffAccount(profile) {
  return request('/api/admin/staff', {
    method: 'POST',
    body: JSON.stringify(profile),
  })
}

export async function updateStaffAccount(userId, profile) {
  return request(`/api/admin/staff/${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    body: JSON.stringify(profile),
  })
}

export async function setStaffAccountActive(userId, active) {
  return request(`/api/admin/staff/${encodeURIComponent(userId)}/active`, {
    method: 'PATCH',
    body: JSON.stringify({ active }),
  })
}

export async function setAdminStaffPassword(userId, password) {
  return request(`/api/admin/staff/${encodeURIComponent(userId)}/password`, {
    method: 'PUT',
    body: JSON.stringify({ password }),
  })
}
