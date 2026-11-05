import { useEffect, useRef, useState } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, CheckCircle2, ImagePlus, LogIn, MapPin, RefreshCw, Search, ShieldCheck, UserPlus } from 'lucide-react'
import { getCitizenIdentity, registerCitizen, signInCitizen, signInStaff } from './lib/auth'
import { complaintCategories, getComplaint, submitComplaint } from './lib/complaints'
import { createStaffAccount, getAdminAuditLogs, getAdminDepartments, getAdminStaff, getAdminWards, getStaffDashboard, setAdminStaffPassword, setStaffAccountActive, takeComplaintAction, updateStaffAccount } from './lib/staffManagement'
import { isSupabaseConfigured, requireSupabase } from './lib/supabaseClient'
import './App.css'

const COPYRIGHT_YEAR = 2026
const registrationFields = [
  { name: 'fullName', label: 'Full name', type: 'text', autoComplete: 'name' },
  { name: 'username', label: 'Username', type: 'text', autoComplete: 'username' },
  { name: 'phone', label: 'Mobile number (E.164, e.g. +919876543210)', type: 'tel', autoComplete: 'tel' },
  { name: 'address', label: 'Residential address', type: 'text', autoComplete: 'street-address' },
  { name: 'email', label: 'Email address', type: 'email', autoComplete: 'email' },
  { name: 'password', label: 'Password', type: 'password', autoComplete: 'new-password' },
  { name: 'confirm', label: 'Confirm password', type: 'password', autoComplete: 'new-password' },
]

function Brand() {
  return (
    <Link className="brand" to="/" aria-label="AplaJansevak home">
      <span className="brand-mark" aria-hidden="true"><MapPin size={21} /></span>
      <span className="brand-copy">AplaJansevak<small>आपला जनसेवक</small></span>
    </Link>
  )
}

function Header() {
  return (
    <header className="site-header">
      <div className="header-inner">
        <Brand />
        <nav aria-label="Main navigation">
          <Link className="nav-register" to="/register">Register as a citizen</Link>
        </nav>
      </div>
    </header>
  )
}

function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <Brand />
        <p>BNCMC, Bhiwandi</p>
        <small>© {COPYRIGHT_YEAR} AplaJansevak. Your Voice, Our Responsibility.</small>
      </div>
    </footer>
  )
}

function Layout({ children, home = false }) {
  return (
    <div className={home ? 'app-shell home-shell' : 'app-shell'}>
      <Header />
      <main>{children}</main>
      <Footer />
    </div>
  )
}

function Home() {
  return (
    <Layout home>
      <section className="home-hero">
        <div className="hero-content">
          <p className="eyebrow">BNCMC · Bhiwandi · Ward No. 06 pilot</p>
          <h1>Your Voice, Our Responsibility.</h1>
          <p className="hero-lede">Report civic problems and help make your neighbourhood better.</p>
          <div className="hero-actions">
            <Link className="button button-primary" to="/login">Citizen Login <ArrowRight size={18} /></Link>
            <Link className="button button-secondary" to="/register"><UserPlus size={18} /> Register as a Citizen</Link>
          </div>
          <p className="hero-note"><ShieldCheck size={17} /> A citizen-first service for Bhiwandi</p>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="art-orbit orbit-one" />
          <div className="art-orbit orbit-two" />
          <div className="art-pin"><MapPin size={50} strokeWidth={1.5} /></div>
          <span className="art-label">Bhiwandi</span>
          <span className="art-ward">Ward 06</span>
        </div>
      </section>
      <section className="staff-access" aria-labelledby="staff-access-title">
        <div>
          <p className="eyebrow">Separate, authorized access</p>
          <h2 id="staff-access-title">Municipal Staff Access</h2>
          <p>For authorized municipal officers and department staff.</p>
        </div>
        <Link className="button button-staff" to="/staff-login">Staff Login <LogIn size={18} /></Link>
      </section>
    </Layout>
  )
}

function safeReturnPath(value) {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/complaints/new'
}

function Auth({ register = false }) {
  const [values, setValues] = useState({})
  const [errors, setErrors] = useState({})
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const returnTo = safeReturnPath(searchParams.get('redirectTo'))

  function validate() {
    const next = {}
    const fields = register
      ? registrationFields
      : [{ name: 'email', label: 'Email address' }, { name: 'password', label: 'Password' }]

    fields.forEach(({ name, label }) => {
      if (!String(values[name] || '').trim()) next[name] = `${label} is required.`
    })

    if (register) {
      if (values.fullName && (values.fullName.trim().length < 2 || values.fullName.length > 100)) {
        next.fullName = 'Enter a name between 2 and 100 characters.'
      }
      if (values.username && !/^[A-Za-z0-9_]{3,30}$/.test(values.username.trim())) {
        next.username = 'Use 3–30 letters, numbers, or underscores.'
      }
      if (values.phone && !/^\+[1-9][0-9]{7,14}$/.test(values.phone.trim())) {
        next.phone = 'Use international format, for example +919876543210.'
      }
      if (values.address && (values.address.trim().length < 10 || values.address.trim().length > 300)) {
        next.address = 'Address must be 10–300 characters.'
      }
      if (values.password && values.password.length < 8) next.password = 'Password must be at least 8 characters.'
      if (values.password !== values.confirm) next.confirm = 'Passwords do not match.'
    }

    return next
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setMessage('')
    const nextErrors = validate()
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) return

    setBusy(true)
    try {
      if (register) {
        const result = await registerCitizen(values)
        if (!result.session) {
          setMessage('Registration received. Confirm your email, then sign in to continue.')
          return
        }
        await getCitizenIdentity(result.user)
      } else {
        await signInCitizen(values)
      }
      navigate(returnTo, { replace: true })
    } catch (error) {
      setMessage(error.message || 'Unable to complete this request.')
    } finally {
      setBusy(false)
    }
  }

  const fields = register
    ? registrationFields
    : [
        { name: 'email', label: 'Email address', type: 'email', autoComplete: 'email' },
        { name: 'password', label: 'Password', type: 'password', autoComplete: 'current-password' },
      ]

  return (
    <Layout>
      <section className="auth-page">
        <div className="auth-intro">
          <p className="eyebrow">Citizen access</p>
          <h1>{register ? 'Register as a citizen' : 'Welcome back'}</h1>
          <p>{register ? 'Create your account to report and follow local civic concerns.' : 'Sign in to continue to your citizen services.'}</p>
          {!isSupabaseConfigured && <p className="notice notice-error">Citizen authentication is not configured in this deployment.</p>}
        </div>
        <form className="form-card" onSubmit={handleSubmit} noValidate>
          {fields.map(({ name, label, type, autoComplete }) => (
            <label className="field" key={name}>
              <span>{label}</span>
              <input
                type={type}
                autoComplete={autoComplete}
                maxLength={name === 'address' ? 300 : name === 'password' || name === 'confirm' ? undefined : 100}
                value={values[name] || ''}
                aria-invalid={Boolean(errors[name])}
                aria-describedby={errors[name] ? `${name}-error` : undefined}
                onChange={event => setValues(current => ({ ...current, [name]: event.target.value }))}
                required
              />
              {errors[name] && <small className="field-error" id={`${name}-error`}>{errors[name]}</small>}
            </label>
          ))}
          <button className="button button-primary form-submit" type="submit" disabled={busy || !isSupabaseConfigured}>
            {busy ? 'Please wait…' : register ? 'Create account' : 'Sign in'} <ArrowRight size={18} />
          </button>
          {message && <p className={`notice ${message.startsWith('Unable') || message.includes('missing') ? 'notice-error' : 'notice-success'}`} role="status">{message}</p>}
          <p className="form-switch">
            {register
              ? <>Already registered? <Link to={`/login?redirectTo=${encodeURIComponent(returnTo)}`}>Citizen login</Link></>
              : <>New here? <Link to={`/register?redirectTo=${encodeURIComponent(returnTo)}`}>Register as a citizen</Link></>}
          </p>
        </form>
      </section>
    </Layout>
  )
}

function StaffAuth() {
  const [mobile, setMobile] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()

  async function handleSubmit(event) {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      const result = await signInStaff({ mobile, password })
      if (result.staff.force_password_change) {
        setMessage('Your account needs an administrator to set a password before you can sign in.')
        return
      }
      navigate('/staff/dashboard', { replace: true })
    } catch (error) {
      setMessage(error.message || 'Unable to sign in with those credentials.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Layout>
      <section className="auth-page">
        <div className="auth-intro">
          <p className="eyebrow">Separate staff access</p>
          <h1>Municipal Staff Login</h1>
          <p>Sign in with your mobile number as username and the password set by your administrator. No verification code is required.</p>
        </div>
        <form className="form-card" onSubmit={handleSubmit} noValidate>
          <label className="field">
            <span>Mobile number (username)</span>
            <input type="tel" inputMode="tel" autoComplete="username" placeholder="+919876543210" value={mobile} onChange={event => setMobile(event.target.value)} required />
          </label>
          <label className="field"><span>Password</span><input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required /></label>
          <button className="button button-primary form-submit" type="submit" disabled={busy || !mobile || !password}>{busy ? 'Please wait…' : 'Staff Login'} <ArrowRight size={18} /></button>
          {message && <p className="notice" role="status">{message}</p>}
        </form>
      </section>
    </Layout>
  )
}

function LoadingPage({ text = 'Checking your secure session…' }) {
  return <div className="loading-page" role="status" aria-live="polite">{text}</div>
}

function RequireCitizen({ children }) {
  const location = useLocation()
  const [state, setState] = useState({ status: 'loading' })

  useEffect(() => {
    let active = true
    async function checkSession() {
      if (!isSupabaseConfigured) {
        if (active) setState({ status: 'error', message: 'Citizen services are not configured.' })
        return
      }
      try {
        const identity = await getCitizenIdentity()
        if (active) setState({ status: 'authorized', identity })
      } catch (error) {
        if (active) {
          if (error.code === 'NETWORK_ERROR') {
            setState({ status: 'error', message: error.message })
            return
          }
          setState({
            status: 'unauthorized',
            staff: error.code === 'STAFF_ACCOUNT',
            message: error.message,
          })
        }
      }
    }
    checkSession()
    return () => { active = false }
  }, [location.pathname])

  if (state.status === 'loading') return <LoadingPage />
  if (state.status === 'error') return <Layout><p className="notice notice-error page-message">{state.message}</p></Layout>
  if (state.status === 'unauthorized') {
    if (state.staff) return <Navigate to="/staff/dashboard" replace />
    const returnTo = `${location.pathname}${location.search}`
    return <Navigate to={`/login?redirectTo=${encodeURIComponent(returnTo)}`} replace />
  }
  return children
}

function ComplaintForm() {
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  const [photo, setPhoto] = useState(null)
  const [coordinates, setCoordinates] = useState(null)
  const [locationError, setLocationError] = useState('')
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const [locating, setLocating] = useState(false)
  const [message, setMessage] = useState('')
  const [draftComplaintId, setDraftComplaintId] = useState(null)
  const [submittedId, setSubmittedId] = useState(null)
  const [photoPreview, setPhotoPreview] = useState('')
  const photoPreviewRef = useRef('')
  const navigate = useNavigate()

  useEffect(() => {
    return () => {
      if (photoPreviewRef.current) URL.revokeObjectURL(photoPreviewRef.current)
    }
  }, [])

  function updatePhoto(file) {
    if (photoPreviewRef.current) URL.revokeObjectURL(photoPreviewRef.current)
    photoPreviewRef.current = file ? URL.createObjectURL(file) : ''
    setPhotoPreview(photoPreviewRef.current)
    setPhoto(file)
  }

  function requestLocation() {
    setLocationError('')
    if (!navigator.geolocation) {
      setLocationError('Location is not supported by this browser. Use a device with location support to continue.')
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      position => {
        const { latitude, longitude, accuracy } = position.coords
        setLocating(false)
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
          setCoordinates(null)
          setLocationError('The browser returned invalid coordinates. Please try again.')
          return
        }
        setCoordinates({ latitude, longitude, accuracy })
      },
      error => {
        setLocating(false)
        setCoordinates(null)
        const reasons = {
          1: 'Location permission was denied. Allow location access in your browser settings, then retry.',
          2: 'Your location could not be determined. Move to an area with a better signal and retry.',
          3: 'Location lookup timed out. Please retry.',
        }
        setLocationError(reasons[error.code] || 'Unable to get your location. Please retry.')
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    )
  }

  function handlePhotoChange(event) {
    const selected = event.target.files?.[0] || null
    setErrors(current => ({ ...current, photo: '' }))
    if (!selected) {
      updatePhoto(null)
      return
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(selected.type)) {
      updatePhoto(null)
      setErrors(current => ({ ...current, photo: 'Choose a JPEG, PNG, or WebP image.' }))
      event.target.value = ''
      return
    }
    if (selected.size <= 0 || selected.size > 5 * 1024 * 1024) {
      updatePhoto(null)
      setErrors(current => ({ ...current, photo: 'Photo must be smaller than 5 MB.' }))
      event.target.value = ''
      return
    }
    updatePhoto(selected)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setMessage('')
    const nextErrors = {}
    if (!category) nextErrors.category = 'Choose a complaint category.'
    if (description.trim().length < 10 || description.trim().length > 5000) {
      nextErrors.description = 'Description must be 10–5000 characters.'
    }
    if (!photo) nextErrors.photo = 'A photograph is required.'
    if (!coordinates) nextErrors.location = 'Capture your location before submitting.'
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) return

    setBusy(true)
    try {
      const complaint = await submitComplaint({
        category,
        description: description.trim(),
        photo,
        coordinates,
        draftComplaintId,
      })
      setSubmittedId(complaint.id)
      setDraftComplaintId(null)
    } catch (error) {
      if (error.complaintId) setDraftComplaintId(error.complaintId)
      setMessage(error.message || 'Unable to submit your complaint.')
    } finally {
      setBusy(false)
    }
  }

  if (submittedId) {
    return (
      <Layout>
        <section className="result-card" aria-labelledby="submission-success">
          <CheckCircle2 size={42} className="success-icon" />
          <p className="eyebrow">Complaint submitted</p>
          <h1 id="submission-success">Thank you for reporting this issue.</h1>
          <p>Your reference ID is:</p>
          <code className="complaint-reference">{submittedId}</code>
          <div className="result-actions">
            <Link className="button button-primary" to={`/complaints/${submittedId}`}>View complaint status <ArrowRight size={18} /></Link>
            <button className="button button-secondary" type="button" onClick={() => navigate('/')}>Return home</button>
          </div>
        </section>
      </Layout>
    )
  }

  return (
    <Layout>
      <section className="form-page">
        <div className="page-heading">
          <p className="eyebrow">Citizen services · Ward No. 06</p>
          <h1>Report a civic problem</h1>
          <p>Share the details and a geotagged photo so the concern can be reviewed. Department routing is pending analysis.</p>
        </div>
        <form className="form-card complaint-form" onSubmit={handleSubmit} noValidate>
          <label className="field">
            <span>Complaint category</span>
            <select value={category} onChange={event => setCategory(event.target.value)} aria-invalid={Boolean(errors.category)} required>
              <option value="">Select a category</option>
              {complaintCategories.map(option => <option value={option} key={option}>{option}</option>)}
            </select>
            {errors.category && <small className="field-error">{errors.category}</small>}
          </label>
          <label className="field">
            <span>Complaint description</span>
            <textarea value={description} onChange={event => setDescription(event.target.value)} rows={6} maxLength={5000} placeholder="Describe the issue and where it is visible." aria-invalid={Boolean(errors.description)} required />
            <small className="field-hint">10–5000 characters · {description.length}/5000</small>
            {errors.description && <small className="field-error">{errors.description}</small>}
          </label>
          <div className="field">
            <span id="photo-label">Photograph <b className="required-mark">Required</b></span>
            <label className="upload-control" htmlFor="complaint-photo">
              <ImagePlus size={22} />
              <span>{photo ? photo.name : 'Choose a photo (JPEG, PNG, WebP · up to 5 MB)'}</span>
              <input id="complaint-photo" type="file" accept="image/jpeg,image/png,image/webp" onChange={handlePhotoChange} aria-labelledby="photo-label" required />
            </label>
            {photoPreview && <img className="photo-preview" src={photoPreview} alt="Preview of the selected complaint photograph" />}
            {errors.photo && <small className="field-error">{errors.photo}</small>}
          </div>
          <div className="field location-field">
            <span>Location information <b className="required-mark">Required</b></span>
            <p className="field-hint">Allow browser location access to record the complaint coordinates. We do not guess or fill in a location.</p>
            {coordinates
              ? <div className="coordinates" role="status">
                  <MapPin size={18} />
                  <span>Latitude {coordinates.latitude.toFixed(6)}, longitude {coordinates.longitude.toFixed(6)}</span>
                </div>
              : <p className="location-pending">Location has not been captured.</p>}
            {locationError && <p className="field-error" role="alert">{locationError}</p>}
            {errors.location && <small className="field-error">{errors.location}</small>}
            <button className="button button-secondary location-retry" type="button" onClick={requestLocation} disabled={locating}>
              <RefreshCw size={16} /> {locating ? 'Getting location…' : coordinates ? 'Update location' : 'Capture my location'}
            </button>
          </div>
          <p className="privacy-note">Your complaint details, photo, and coordinates are stored with your authenticated account. Contact details are not included in the complaint submission.</p>
          <button className="button button-primary form-submit" type="submit" disabled={busy || locating}>
            {busy ? 'Submitting…' : 'Submit complaint'} <ArrowRight size={18} />
          </button>
          {message && (
            <p className="notice notice-error" role="alert">
              {message}
              {draftComplaintId && <> An incomplete record was created with ID <code>{draftComplaintId}</code>. Retry to finish attaching the required photo; it has not been reported as complete.</>}
            </p>
          )}
        </form>
      </section>
    </Layout>
  )
}

function ComplaintDetails() {
  const { pathname } = useLocation()
  const complaintId = pathname.split('/').filter(Boolean).at(-1)
  const [state, setState] = useState({ status: 'loading' })

  useEffect(() => {
    let active = true
    getComplaint(complaintId)
      .then(complaint => { if (active) setState({ status: 'loaded', complaint }) })
      .catch(error => { if (active) setState({ status: 'error', message: error.message }) })
    return () => { active = false }
  }, [complaintId])

  if (state.status === 'loading') return <Layout><LoadingPage text="Loading complaint status…" /></Layout>
  if (state.status === 'error') {
    return <Layout><section className="result-card"><p className="notice notice-error" role="alert">{state.message}</p><Link className="button button-secondary" to="/complaints/new">Back to complaints</Link></section></Layout>
  }

  const { complaint } = state
  return (
    <Layout>
      <section className="details-card">
        <p className="eyebrow">Complaint status</p>
        <h1>{complaint.category}</h1>
        <p className="status-pill">{complaint.status.replaceAll('_', ' ')}</p>
        <dl className="details-list">
          <div><dt>Reference ID</dt><dd>{complaint.id}</dd></div>
          <div><dt>Submitted</dt><dd>{new Date(complaint.created_at).toLocaleString()}</dd></div>
          <div><dt>Ward</dt><dd>Ward No. 06</dd></div>
          <div><dt>Description</dt><dd>{complaint.description}</dd></div>
          <div><dt>Location</dt><dd>{Number(complaint.latitude).toFixed(6)}, {Number(complaint.longitude).toFixed(6)}</dd></div>
        </dl>
        <Link className="button button-secondary" to="/complaints/new">Report another problem</Link>
      </section>
    </Layout>
  )
}

function TrackComplaint() {
  const [id, setId] = useState('')
  const navigate = useNavigate()
  return (
    <Layout>
      <section className="auth-page">
        <div className="auth-intro"><p className="eyebrow">Citizen access</p><h1>Track a complaint</h1><p>Sign in to view the status of a complaint linked to your account.</p></div>
        <form className="form-card" onSubmit={event => { event.preventDefault(); if (id.trim()) navigate(`/complaints/${encodeURIComponent(id.trim())}`) }}>
          <label className="field"><span>Complaint reference ID</span><input value={id} onChange={event => setId(event.target.value.trim())} required /></label>
          <button className="button button-primary form-submit" type="submit" disabled={!id.trim()}>View status <ArrowRight size={18} /></button>
          <p className="form-switch"><Link to="/login">Sign in to your citizen account</Link></p>
        </form>
      </section>
    </Layout>
  )
}

function StaffDashboard() {
  const [state, setState] = useState({ status: 'loading' })
  const [onlyAssigned, setOnlyAssigned] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    let active = true
    getStaffDashboard()
      .then(data => { if (active) setState({ status: 'authorized', ...data }) })
      .catch(error => {
        if (active) setState({ status: 'error', message: error.message || 'Unable to verify staff authorization.' })
      })
    return () => { active = false }
  }, [])

  async function runAction(complaintId, action) {
    setState(current => ({ ...current, busyId: complaintId, actionMessage: '' }))
    try {
      await takeComplaintAction(complaintId, action)
      const data = await getStaffDashboard()
      setState({ status: 'authorized', ...data, actionMessage: 'Complaint activity recorded.' })
    } catch (error) {
      setState(current => ({ ...current, busyId: null, actionMessage: error.message }))
    }
  }

  async function openComplaintPhoto(complaintId, photoPath) {
    try {
      const { data, error } = await requireSupabase()
        .storage.from('complaint-photos')
        .createSignedUrl(photoPath, 60)
      if (error) throw error
      setState(current => ({
        ...current,
        photoLinks: { ...current.photoLinks, [complaintId]: data.signedUrl },
      }))
    } catch (error) {
      setState(current => ({ ...current, actionMessage: error.message || 'Unable to open this authorized complaint photo.' }))
    }
  }

  const visibleComplaints = state.status === 'authorized'
    ? state.complaints.filter(complaint =>
      !onlyAssigned || complaint.assignments.some(assignment =>
        assignment.staff_user_id === state.staff.user_id && !assignment.unassigned_at,
      ),
    )
    : []

  if (state.status === 'loading') return <Layout><LoadingPage text="Verifying staff authorization…" /></Layout>
  if (state.status !== 'authorized') {
    return (
      <Layout>
        <section className="result-card">
          <p className="eyebrow">Staff access</p>
          <h1>Access could not be verified</h1>
          <p className="notice notice-error" role="alert">{state.message}</p>
          <button className="button button-secondary" type="button" onClick={async () => { await requireSupabase().auth.signOut(); navigate('/staff-login', { replace: true }) }}>Return to staff login</button>
        </section>
      </Layout>
    )
  }

  return (
    <Layout>
      <section className="details-card staff-dashboard">
        <p className="eyebrow">Authorized staff dashboard</p>
        <h1>Complaint Work Queue</h1>
        <p>Complaint records are limited by your active department, ward, and database-authorized permissions.</p>
        <dl className="details-list">
          <div><dt>Role</dt><dd>{state.staff.role}</dd></div>
          <div><dt>Department</dt><dd>{state.departments.find(department => department.id === state.staff.department_id)?.name || 'Cross-department administrator'}</dd></div>
        </dl>
        <div className="work-stat-grid">
          {[['Assigned to me', state.stats.assigned], ['Pending', state.stats.pending], ['Submitted', state.stats.submitted], ['In progress', state.stats.in_progress], ['Resolved', state.stats.resolved], ['Visible total', state.stats.total]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
        </div>
        {state.staff.is_main_system_admin && state.complaints.length > 0 && <div className="department-statistics"><h2>Department complaint counts</h2>{state.departments.map(department => {
          const count = state.complaints.filter(complaint => complaint.department_id === department.id).length
          return <p key={department.id}><strong>{department.name_mr}</strong> · {department.name}: {count}</p>
        })}{state.complaints.some(complaint => !complaint.department_id) && <p><strong>Unrouted (manual review required)</strong>: {state.complaints.filter(complaint => !complaint.department_id).length}</p>}<p className="field-hint">Overdue tracking is unavailable until an approved due-date/SLA rule exists.</p></div>}
        {state.staff.is_main_system_admin && <button className="button button-secondary" type="button" onClick={() => navigate('/staff/management')}>Open staff and department management</button>}
        {state.actionMessage && <p className="notice" role="status">{state.actionMessage}</p>}
        <div className="queue-filters"><button type="button" className={onlyAssigned ? 'button button-primary' : 'button button-secondary'} aria-pressed={onlyAssigned} onClick={() => setOnlyAssigned(value => !value)}>{onlyAssigned ? 'Showing my assigned complaints' : 'Show only complaints assigned to me'}</button></div>
        <div className="work-queue">
          {visibleComplaints.length ? visibleComplaints.map(complaint => {
            const activeAssignment = complaint.assignments.find(assignment => !assignment.unassigned_at)
            const department = state.departments.find(item => item.id === complaint.department_id)
            const ward = state.wards.find(item => item.id === complaint.ward_id)
            return (
              <article className="work-card" key={complaint.id}>
                <div className="work-card-heading">
                  <div><p className="eyebrow">{complaint.category} · {department?.name || 'Unrouted'} · Ward {ward ? String(ward.ward_number).padStart(2, '0') : complaint.ward_id}</p><h2>{complaint.title}</h2></div>
                  <span className="status-pill">{complaint.status.replaceAll('_', ' ')}</span>
                </div>
                <p>{complaint.description}</p>
                <p className="field-hint">Reference {complaint.id} · Submitted {new Date(complaint.created_at).toLocaleString()}</p>
                {Number.isFinite(Number(complaint.latitude)) && Number.isFinite(Number(complaint.longitude)) &&
                  <p className="field-hint">Location: {Number(complaint.latitude).toFixed(6)}, {Number(complaint.longitude).toFixed(6)}</p>}
                {complaint.photo_path && (
                  <div className="work-photo">
                    {state.photoLinks?.[complaint.id]
                      ? <a href={state.photoLinks[complaint.id]} target="_blank" rel="noreferrer">Open private complaint photo</a>
                      : <button className="text-button" type="button" onClick={() => openComplaintPhoto(complaint.id, complaint.photo_path)}>View authorized photo</button>}
                  </div>
                )}
                <p className="field-hint">Assigned to: {activeAssignment?.staff?.full_name_mr || activeAssignment?.staff?.full_name_en || 'Unassigned'}</p>
                {state.staff.canRoute && !complaint.department_id && (
                  <form className="work-action route-action" onSubmit={event => {
                    event.preventDefault()
                    const departmentId = new FormData(event.currentTarget).get('department')
                    if (departmentId) runAction(complaint.id, { action: 'route', department_id: departmentId, note: 'Manually routed by an authorized administrator.' })
                  }}>
                    <label className="field"><span>Manual department routing (review complaint details)</span><select name="department" required defaultValue=""><option value="" disabled>Select department</option>{state.departments.map(item => <option key={item.id} value={item.id}>{item.name_mr} · {item.name}</option>)}</select></label>
                    <button className="button button-secondary" disabled={state.busyId === complaint.id}>Route complaint</button>
                  </form>
                )}
                {state.staff.canUpdate && (
                  <form className="work-action" onSubmit={event => {
                    event.preventDefault()
                    const form = new FormData(event.currentTarget)
                    runAction(complaint.id, { action: 'status', status: form.get('status'), note: form.get('note') })
                  }}>
                    <label className="field"><span>Update status</span><select name="status" defaultValue={complaint.status === 'submitted' ? 'acknowledged' : complaint.status === 'acknowledged' ? 'in_progress' : complaint.status}><option value="acknowledged">Acknowledged</option><option value="in_progress">In progress</option><option value="resolved">Resolved</option><option value="closed">Closed</option><option value="rejected">Rejected</option></select></label>
                    <label className="field"><span>Status note (visible to the complaint owner)</span><input name="note" maxLength="2000" /></label>
                    <button className="button button-secondary" disabled={state.busyId === complaint.id}>Save status</button>
                  </form>
                )}
                {state.staff.canAssign && complaint.staffOptions?.length > 0 && (
                  <form className="work-action" onSubmit={event => {
                    event.preventDefault()
                    const assignee = new FormData(event.currentTarget).get('assignee')
                    if (assignee) runAction(complaint.id, { action: 'assign', assignee_id: assignee })
                  }}>
                    <label className="field"><span>Assign to authorized staff</span><select name="assignee" defaultValue=""><option value="" disabled>Select officer</option>{complaint.staffOptions.map(option => <option key={option.user_id} value={option.user_id}>{option.full_name_mr || option.full_name_en || option.staff_id || option.user_id}</option>)}</select></label>
                    <button className="button button-secondary" disabled={state.busyId === complaint.id}>Assign complaint</button>
                  </form>
                )}
                {state.staff.canEscalate && state.staff.managerId && (
                  <button className="button button-secondary" type="button" disabled={state.busyId === complaint.id} onClick={() => runAction(complaint.id, { action: 'escalate', assignee_id: state.staff.managerId, note: 'Escalated to the configured reporting officer.' })}>Escalate to reporting officer</button>
                )}
                {!!complaint.history.length && <details className="activity-history"><summary>Assignment and status history</summary><ol>{complaint.history.map((item, index) => <li key={`${item.created_at}-${index}`}><strong>{item.event_type}</strong> · {item.actor?.full_name_mr || item.actor?.full_name_en || 'Authorized staff'} · {new Date(item.created_at).toLocaleString()}{item.note && <p>{item.note}</p>}{item.previousAssignee && <span>From {item.previousAssignee.full_name_mr || item.previousAssignee.full_name_en}; </span>}{item.newAssignee && <span>to {item.newAssignee.full_name_mr || item.newAssignee.full_name_en}</span>}</li>)}</ol></details>}
              </article>
            )
          }) : <p className="field-hint">{onlyAssigned ? 'No complaints are assigned to this account.' : 'No complaints are currently visible to this account’s department, ward, and permissions.'}</p>}
        </div>
        <button className="button button-secondary" type="button" onClick={async () => { await requireSupabase().auth.signOut(); navigate('/', { replace: true }) }}>Sign out</button>
      </section>
    </Layout>
  )
}

function emptyStaffProfile() {
  return {
    staff_id: '', full_name_mr: '', full_name_en: '', designation_mr: '', designation_en: '',
    department_id: '', mobile_e164: '', official_contact_number: '', role: 'staff',
    active: true, profile_verified: false, ward_ids: [], permissions: [], reports_to_user_id: '',
  }
}

function StaffManagement() {
  const [state, setState] = useState({ status: 'loading', departments: [], wards: [], staff: [], logs: [] })
  const [profile, setProfile] = useState(emptyStaffProfile)
  const [editingId, setEditingId] = useState('')
  const [initialPassword, setInitialPassword] = useState('')
  const [confirmInitialPassword, setConfirmInitialPassword] = useState('')
  const [passwordTarget, setPasswordTarget] = useState(null)
  const [adminPassword, setAdminPassword] = useState('')
  const [confirmAdminPassword, setConfirmAdminPassword] = useState('')
  const [search, setSearch] = useState('')
  const [departmentFilter, setDepartmentFilter] = useState('')
  const [tab, setTab] = useState('directory')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function fetchDirectory() {
    const [departments, wards, staff, logs] = await Promise.all([
      getAdminDepartments(), getAdminWards(), getAdminStaff(), getAdminAuditLogs(),
    ])
    return { status: 'loaded', departments, wards, staff, logs }
  }

  async function load() {
    try { setState(await fetchDirectory()) }
    catch (error) { setState(current => ({ ...current, status: 'error', message: error.message })) }
  }

  useEffect(() => {
    let active = true
    fetchDirectory()
      .then(data => { if (active) setState(data) })
      .catch(error => { if (active) setState(current => ({ ...current, status: 'error', message: error.message })) })
    return () => { active = false }
  }, [])

  function editStaff(row) {
    setEditingId(row.user_id)
    setProfile({
      staff_id: row.staff_id || '',
      full_name_mr: row.full_name_mr || '',
      full_name_en: row.full_name_en || '',
      designation_mr: row.designation_mr || '',
      designation_en: row.designation_en || '',
      department_id: row.department_id,
      mobile_e164: row.mobile_e164,
      official_contact_number: row.official_contact_number,
      role: row.role,
      active: row.active,
      profile_verified: row.profile_verified,
      ward_ids: row.wards.map(ward => ward.id),
      permissions: row.permissions.map(permission => ({ permission_code: permission.permission_code, ward_id: permission.ward_id })),
      reports_to_user_id: row.reports_to_user_id || '',
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelEdit(keepMessage = false) {
    setEditingId('')
    setProfile(emptyStaffProfile())
    if (!keepMessage) setMessage('')
  }

  function toggleWard(wardId) {
    setProfile(current => {
      const wardIds = current.ward_ids.includes(wardId)
        ? current.ward_ids.filter(id => id !== wardId)
        : [...current.ward_ids, wardId]
      return {
        ...current,
        ward_ids: wardIds,
        permissions: current.permissions.filter(permission => wardIds.includes(permission.ward_id)),
      }
    })
  }

  function togglePermission(wardId, permissionCode) {
    setProfile(current => {
      const exists = current.permissions.some(item => item.ward_id === wardId && item.permission_code === permissionCode)
      return {
        ...current,
        permissions: exists
          ? current.permissions.filter(item => item.ward_id !== wardId || item.permission_code !== permissionCode)
          : [...current.permissions, { ward_id: wardId, permission_code: permissionCode }],
      }
    })
  }

  async function submitProfile(event) {
    event.preventDefault()
    if (!editingId && (initialPassword.length < 12 || initialPassword.length > 128 || initialPassword !== confirmInitialPassword)) {
      setMessage('Set matching staff passwords between 12 and 128 characters.')
      return
    }
    if (!window.confirm(`${editingId ? 'Save changes to' : 'Create'} this staff account and its ward/permission assignments?`)) return
    setBusy(true)
    setMessage('')
    try {
      const result = editingId
        ? await updateStaffAccount(editingId, profile)
        : await createStaffAccount({ ...profile, password: initialPassword })
      setMessage(result.message || (profile.profile_verified ? 'Verified staff profile saved.' : 'Unverified staff profile saved pending administrator review.'))
      setInitialPassword('')
      setConfirmInitialPassword('')
      cancelEdit(true)
      await load()
    } catch (error) {
      setMessage(error.message || 'Unable to save this staff profile.')
    } finally {
      setBusy(false)
    }
  }

  async function toggleActive(row) {
    const active = !row.active
    if (!window.confirm(`${active ? 'Activate' : 'Deactivate'} this staff account?`)) return
    setBusy(true)
    try {
      await setStaffAccountActive(row.user_id, active)
      setMessage(`Staff account ${active ? 'activated' : 'deactivated'}.`)
      await load()
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusy(false)
    }
  }

  async function resetPassword(row) {
    setPasswordTarget({ userId: row.user_id, mobile: row.mobile_e164 })
    setAdminPassword('')
    setConfirmAdminPassword('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function submitAdminPassword(event) {
    event.preventDefault()
    if (!passwordTarget || adminPassword.length < 12 || adminPassword.length > 128 || adminPassword !== confirmAdminPassword) {
      setMessage('Set matching staff passwords between 12 and 128 characters.')
      return
    }
    if (!window.confirm(`Set a new password for ${passwordTarget.mobile}? Share it with the staff member through a secure channel.`)) return
    setBusy(true)
    try {
      const result = await setAdminStaffPassword(passwordTarget.userId, adminPassword)
      setMessage(result.message)
      setPasswordTarget(null)
      setAdminPassword('')
      setConfirmAdminPassword('')
      await load()
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusy(false)
    }
  }

  if (state.status === 'loading') return <Layout><LoadingPage text="Verifying administrator access…" /></Layout>
  if (state.status === 'error') return <Layout><section className="result-card"><p className="eyebrow">Staff administration</p><h1>Access could not be verified</h1><p className="notice notice-error" role="alert">{state.message}</p><Link className="button button-secondary" to="/staff/dashboard">Return to dashboard</Link></section></Layout>

  const query = search.trim().toLocaleLowerCase()
  const visibleStaff = state.staff.filter(row => {
    const matchesDepartment = !departmentFilter || row.department_id === departmentFilter
    const text = [row.staff_id, row.full_name_mr, row.full_name_en, row.designation_mr, row.designation_en].join(' ').toLocaleLowerCase()
    return matchesDepartment && (!query || text.includes(query))
  })
  const permissionNames = [
    ['complaints.read', 'Read complaints'],
    ['complaints.update', 'Update status'],
    ['complaints.assign', 'Assign complaints'],
    ['complaints.escalate', 'Escalate'],
  ]

  function renderHierarchy(rows, parentId = null, depth = 0) {
    const children = rows.filter(row => parentId
      ? row.reports_to_user_id === parentId
      : !row.reports_to_user_id || !rows.some(candidate => candidate.user_id === row.reports_to_user_id))
    if (!children.length) return null
    return <ul className="hierarchy-list">{children.map(row => {
      const reportsTo = rows.find(candidate => candidate.user_id === row.reports_to_user_id)
      return <li key={row.user_id}><article className="directory-person" style={{ '--tree-depth': depth }}><div><strong>{row.full_name_mr || row.full_name_en || 'Name pending verification'}</strong>{row.full_name_mr && row.full_name_en && <span>{row.full_name_en}</span>}<small>{row.designation_mr || row.designation_en || 'Designation pending verification'}{row.staff_id ? ` · ${row.staff_id}` : ''}{reportsTo && ` · Reports to ${reportsTo.full_name_mr || reportsTo.full_name_en || reportsTo.staff_id}`}</small><small>Official contact: {row.official_contact_number || 'Not recorded'}</small></div><span className={row.active && row.approved ? 'staff-status status-active' : 'staff-status'}>{row.active && row.approved ? 'Active' : row.active ? 'Pending verification' : 'Inactive'}</span><div className="directory-actions"><button type="button" className="text-button" onClick={() => editStaff(row)}>Edit</button><button type="button" className="text-button" disabled={busy} onClick={() => toggleActive(row)}>{row.active ? 'Deactivate' : 'Activate'}</button><button type="button" className="text-button" disabled={busy || !row.active || !row.approved} onClick={() => resetPassword(row)}>Reset password</button></div></article>{renderHierarchy(rows, row.user_id, depth + 1)}</li>
    })}</ul>
  }

  return (
    <Layout>
      <section className="management-page">
        <header className="management-heading"><div><p className="eyebrow">Restricted administrator access</p><h1>Department and Staff Management</h1><p>Only the Main System Administrator can manage accounts, reporting relationships, wards, and permissions.</p></div><button className="button button-secondary" type="button" onClick={() => window.location.assign('/staff/dashboard')}>Staff dashboard</button></header>
        <div className="management-tabs" aria-label="Staff management sections"><button type="button" aria-pressed={tab === 'directory'} onClick={() => setTab('directory')}>Department directory</button><button type="button" aria-pressed={tab === 'audit'} onClick={() => setTab('audit')}>Audit log</button></div>
        {message && <p className="notice" role="status">{message}</p>}
        {tab === 'directory' ? <>
          {passwordTarget && <form className="form-card staff-editor" onSubmit={submitAdminPassword}>
            <h2>Set staff password</h2>
            <p className="field-hint">The password is saved by Supabase Auth and is never stored in the staff profile. No phone or email verification is sent.</p>
            <label className="field"><span>Staff mobile username</span><input value={passwordTarget.mobile} readOnly /></label>
            <label className="field"><span>New password (12–128 characters)</span><input type="password" autoComplete="new-password" value={adminPassword} onChange={event => setAdminPassword(event.target.value)} minLength="12" maxLength="128" required /></label>
            <label className="field"><span>Confirm new password</span><input type="password" autoComplete="new-password" value={confirmAdminPassword} onChange={event => setConfirmAdminPassword(event.target.value)} minLength="12" maxLength="128" required /></label>
            <div className="editor-actions"><button className="button button-primary" type="submit" disabled={busy || adminPassword.length < 12 || adminPassword !== confirmAdminPassword}>{busy ? 'Saving…' : 'Save password'}</button><button className="button button-secondary" type="button" onClick={() => setPasswordTarget(null)}>Cancel</button></div>
          </form>}
          <form className="form-card staff-editor" onSubmit={submitProfile}>
            <h2>{editingId ? 'Edit staff profile' : 'Create staff account'}</h2>
            <p className="field-hint">The mobile number is the username. An administrator sets the password; no phone or email verification is required. Passwords are stored only in Supabase Auth, never in the staff profile.</p>
            <div className="management-form-grid">
              <label className="field"><span>Staff ID</span><input value={profile.staff_id} onChange={event => setProfile({ ...profile, staff_id: event.target.value })} maxLength="80" /></label>
              <label className="field"><span>Department</span><select required value={profile.department_id} onChange={event => setProfile({ ...profile, department_id: event.target.value, reports_to_user_id: '' })}><option value="">Select department</option>{state.departments.map(department => <option key={department.id} value={department.id}>{department.name_mr} · {department.name}</option>)}</select></label>
              <label className="field"><span>Full name (Marathi)</span><input value={profile.full_name_mr} onChange={event => setProfile({ ...profile, full_name_mr: event.target.value })} /></label>
              <label className="field"><span>Full name (English)</span><input value={profile.full_name_en} onChange={event => setProfile({ ...profile, full_name_en: event.target.value })} /></label>
              <label className="field"><span>Designation (Marathi)</span><input value={profile.designation_mr} onChange={event => setProfile({ ...profile, designation_mr: event.target.value })} /></label>
              <label className="field"><span>Designation (English)</span><input value={profile.designation_en} onChange={event => setProfile({ ...profile, designation_en: event.target.value })} /></label>
              <label className="field"><span>Staff login mobile (India)</span><input type="tel" placeholder="+919876543210" required disabled={Boolean(editingId)} value={profile.mobile_e164} onChange={event => setProfile({ ...profile, mobile_e164: event.target.value })} /></label>
              {!editingId && <>
                <label className="field"><span>Password (12–128 characters)</span><input type="password" autoComplete="new-password" minLength="12" maxLength="128" required value={initialPassword} onChange={event => setInitialPassword(event.target.value)} /></label>
                <label className="field"><span>Confirm password</span><input type="password" autoComplete="new-password" minLength="12" maxLength="128" required value={confirmInitialPassword} onChange={event => setConfirmInitialPassword(event.target.value)} /></label>
              </>}
              <label className="field"><span>Official contact number</span><input type="tel" placeholder="+919876543210" value={profile.official_contact_number} onChange={event => setProfile({ ...profile, official_contact_number: event.target.value })} /></label>
              <label className="field"><span>Account role</span><select value={profile.role} onChange={event => setProfile({ ...profile, role: event.target.value })}><option value="staff">Staff</option><option value="supervisor">Supervisor</option><option value="administrator">Administrator (not Main System Administrator)</option></select></label>
              <label className="field"><span>Reporting officer</span><select value={profile.reports_to_user_id} onChange={event => setProfile({ ...profile, reports_to_user_id: event.target.value })}><option value="">No reporting officer configured</option>{state.staff.filter(row => row.department_id === profile.department_id && row.user_id !== editingId && row.active && row.approved && !row.force_password_change).map(row => <option key={row.user_id} value={row.user_id}>{row.full_name_mr || row.full_name_en || row.staff_id}</option>)}</select></label>
            </div>
            <fieldset className="management-fieldset"><legend>Authorized wards</legend><div className="ward-checkboxes">{state.wards.map(ward => <label key={ward.id}><input type="checkbox" checked={profile.ward_ids.includes(ward.id)} disabled={!ward.is_active && !profile.ward_ids.includes(ward.id)} onChange={() => toggleWard(ward.id)} /> Ward {String(ward.ward_number).padStart(2, '0')} · {ward.ward_name}{!ward.is_active && ' (inactive)'}</label>)}</div></fieldset>
            <fieldset className="management-fieldset"><legend>Permissions by assigned ward</legend>{profile.ward_ids.map(wardId => {
              const ward = state.wards.find(item => item.id === wardId)
              return <div className="permission-ward" key={wardId}><strong>Ward {String(ward?.ward_number || '').padStart(2, '0')}</strong><div className="permission-checkboxes">{permissionNames.map(([code, label]) => <label key={code}><input type="checkbox" checked={profile.permissions.some(item => item.ward_id === wardId && item.permission_code === code)} onChange={() => togglePermission(wardId, code)} />{label}</label>)}</div></div>
            })}{!profile.ward_ids.length && <p className="field-hint">Choose wards before granting complaint permissions.</p>}</fieldset>
            <label className="verification-check"><input type="checkbox" checked={profile.profile_verified} onChange={event => setProfile({ ...profile, profile_verified: event.target.checked })} /><span>Names, staff ID, designation, and reporting details have been verified against the official directory. Unverified profiles remain unapproved.</span></label>
            <label className="verification-check"><input type="checkbox" checked={profile.active} onChange={event => setProfile({ ...profile, active: event.target.checked })} /><span>Account active</span></label>
            <div className="editor-actions"><button className="button button-primary" type="submit" disabled={busy || !profile.department_id || !profile.mobile_e164}>{busy ? 'Saving…' : editingId ? 'Save staff changes' : 'Create staff account'}</button>{editingId && <button className="button button-secondary" type="button" onClick={cancelEdit}>Cancel</button>}</div>
          </form>
          <div className="directory-controls">
            <label className="field"><span>Search staff by name, ID, or designation</span><div className="search-field"><Search size={18} /><input value={search} onChange={event => setSearch(event.target.value)} /></div></label>
            <label className="field"><span>Filter department</span><select value={departmentFilter} onChange={event => setDepartmentFilter(event.target.value)}><option value="">All departments</option>{state.departments.map(department => <option key={department.id} value={department.id}>{department.name_mr} · {department.name}</option>)}</select></label>
          </div>
          <div className="department-directory">{state.departments.filter(department => !departmentFilter || department.id === departmentFilter).map(department => {
            const rows = visibleStaff.filter(row => row.department_id === department.id)
            return <section className="department-card" key={department.id}><h2>{department.name_mr}</h2><p>{department.name}</p>{rows.length ? renderHierarchy(rows) : <p className="field-hint">No directory entries match this filter. Add staff only from a verified official source.</p>}</section>
          })}</div>
        </> : <section className="audit-list"><h2>Recent administrative changes</h2>{state.logs.length ? state.logs.map(log => <article key={log.id}><strong>{log.action}</strong><span>{log.target_type} {log.target_id || ''}</span><time>{new Date(log.created_at).toLocaleString()}</time><pre>{JSON.stringify(log.details, null, 2)}</pre></article>) : <p>No audit events recorded.</p>}</section>}
      </section>
    </Layout>
  )
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/register" element={<Auth register />} />
      <Route path="/login" element={<Auth />} />
      <Route path="/staff-login" element={<StaffAuth />} />
      <Route path="/staff/dashboard" element={<StaffDashboard />} />
      <Route path="/staff/management" element={<StaffManagement />} />
      <Route path="/complaints/new" element={<RequireCitizen><ComplaintForm /></RequireCitizen>} />
      <Route path="/complaints/:id" element={<RequireCitizen><ComplaintDetails /></RequireCitizen>} />
      <Route path="/report" element={<Navigate to="/complaints/new" replace />} />
      <Route path="/track" element={<RequireCitizen><TrackComplaint /></RequireCitizen>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return <BrowserRouter><AppRoutes /></BrowserRouter>
}
