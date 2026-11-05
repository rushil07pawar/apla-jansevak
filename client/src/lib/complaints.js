import { requireSupabase } from './supabaseClient'

export const complaintCategories = [
  'Roads & footpaths',
  'Water & drainage',
  'Cleanliness',
  'Street lighting',
]

const bucketName = 'complaint-photos'
const maxPhotoBytes = 5 * 1024 * 1024
const photoExtensions = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

function assertPhoto(photo) {
  if (!photo) throw new Error('A complaint photograph is required.')
  if (!photoExtensions[photo.type]) throw new Error('Choose a JPEG, PNG, or WebP image.')
  if (photo.size <= 0 || photo.size > maxPhotoBytes) throw new Error('Photo must be smaller than 5 MB.')
}

function withComplaintId(error, complaintId, action) {
  const wrapped = new Error(`The complaint ${action} could not be completed: ${error.message}`)
  wrapped.complaintId = complaintId
  return wrapped
}

export async function submitComplaint({ category, description, photo, coordinates, draftComplaintId }) {
  assertPhoto(photo)
  if (!complaintCategories.includes(category)) {
    throw new Error('Choose a valid complaint category.')
  }
  if (typeof description !== 'string' || description.trim().length < 10 || description.trim().length > 5000) {
    throw new Error('Description must be 10–5000 characters.')
  }
  if (
    !coordinates
    || !Number.isFinite(coordinates.latitude)
    || !Number.isFinite(coordinates.longitude)
    || Math.abs(coordinates.latitude) > 90
    || Math.abs(coordinates.longitude) > 180
  ) {
    throw new Error('A category, description, photograph, and captured location are required.')
  }

  const client = requireSupabase()
  const { data: { user }, error: authError } = await client.auth.getUser()
  if (authError) throw authError
  if (!user) throw new Error('Your session expired. Sign in again to submit your complaint.')

  const { data: ward, error: wardError } = await client
    .from('wards')
    .select('id')
    .eq('ward_number', 6)
    .eq('is_active', true)
    .maybeSingle()
  if (wardError) throw wardError
  if (!ward) throw new Error('The active Ward 06 pilot is not available. Please contact support.')

  const complaintData = {
    title: category,
    category,
    description: description.trim(),
    ward_id: ward.id,
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
  }
  let complaintId = draftComplaintId
  if (complaintId) {
    const { data: draft, error: draftError } = await client
      .from('complaints')
      .update(complaintData)
      .eq('id', complaintId)
      .eq('citizen_id', user.id)
      .eq('status', 'submitted')
      .is('department_id', null)
      .is('photo_path', null)
      .select('id')
      .maybeSingle()
    if (draftError) throw draftError
    if (!draft) throw new Error('The incomplete complaint could not be found. Start a new complaint.')
  } else {
    const { data: complaint, error: insertError } = await client
      .from('complaints')
      .insert({
        citizen_id: user.id,
        ...complaintData,
      })
      .select('id')
      .single()
    if (insertError) throw insertError
    complaintId = complaint.id
  }

  const extension = photoExtensions[photo.type]
  const photoPath = `${user.id}/${complaintId}/${crypto.randomUUID()}.${extension}`
  const { error: uploadError } = await client.storage
    .from(bucketName)
    .upload(photoPath, photo, { contentType: photo.type, upsert: false })
  if (uploadError) {
    throw withComplaintId(uploadError, complaintId, 'photo upload')
  }

  const { data: linkedComplaint, error: linkError } = await client
    .from('complaints')
    .update({ photo_path: photoPath })
    .eq('id', complaintId)
    .eq('citizen_id', user.id)
    .is('photo_path', null)
    .select('id')
    .maybeSingle()

  if (linkError || !linkedComplaint) {
    const { error: cleanupError } = await client.storage.from(bucketName).remove([photoPath])
    const cause = linkError || new Error('The uploaded photo could not be linked to the complaint.')
    if (cleanupError) {
      throw withComplaintId(
        new Error(`${cause.message} The uploaded photo also could not be cleaned up: ${cleanupError.message}`),
        complaintId,
        'submission',
      )
    }
    throw withComplaintId(cause, complaintId, 'photo attachment')
  }

  return { id: linkedComplaint.id }
}

export async function getComplaint(id) {
  const client = requireSupabase()
  const { data: { user }, error: authError } = await client.auth.getUser()
  if (authError) throw authError
  if (!user) throw new Error('Sign in to view complaint status.')

  const { data: complaint, error } = await client
    .from('complaints')
    .select('id, category, description, status, created_at, ward_id, latitude, longitude')
    .eq('id', id)
    .eq('citizen_id', user.id)
    .maybeSingle()
  if (error) throw error
  if (!complaint) throw new Error('Complaint not found or you are not authorized to view it.')
  return complaint
}
