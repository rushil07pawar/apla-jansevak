import { useEffect, useRef, useState } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, CheckCircle2, ImagePlus, LogIn, MapPin, RefreshCw, ShieldCheck, UserPlus } from 'lucide-react'
import { getCitizenIdentity, registerCitizen, signInCitizen, signInStaff, requestStaffPasswordRecovery } from './lib/auth'
import { complaintCategories, getComplaint, submitComplaint } from './lib/complaints'
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
        setMessage('Your temporary password must be changed before accessing staff services. Use the recovery option or contact your administrator.')
        return
      }
      navigate('/staff/dashboard', { replace: true })
    } catch (error) {
      setMessage(error.message || 'Unable to sign in with those credentials.')
    } finally {
      setBusy(false)
    }
  }

  async function handleRecovery() {
    setBusy(true)
    setMessage('')
    try {
      setMessage(await requestStaffPasswordRecovery(mobile))
    } catch (error) {
      setMessage(error.message || 'Unable to request password recovery.')
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
          <p>Use your registered mobile number and administrator-created password.</p>
        </div>
        <form className="form-card" onSubmit={handleSubmit} noValidate>
          <label className="field">
            <span>Mobile number</span>
            <input type="tel" inputMode="tel" autoComplete="username" placeholder="+919876543210" value={mobile} onChange={event => setMobile(event.target.value)} required />
          </label>
          <label className="field">
            <span>Password</span>
            <input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required />
          </label>
          <button className="button button-primary form-submit" type="submit" disabled={busy || !mobile || !password}>
            {busy ? 'Please wait…' : 'Staff Login'} <ArrowRight size={18} />
          </button>
          <button className="text-button recovery-button" type="button" disabled={busy || !mobile} onClick={handleRecovery}>
            Forgot password?
          </button>
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
  const navigate = useNavigate()

  useEffect(() => {
    let active = true
    async function loadDashboard() {
      try {
        const client = requireSupabase()
        const { data: { user }, error: userError } = await client.auth.getUser()
        if (userError) throw userError
        if (!user) {
          if (active) setState({ status: 'unauthenticated' })
          return
        }

        const { data: staff, error: staffError } = await client
          .from('staff_profiles')
          .select('user_id, department_id, role, active, approved, force_password_change')
          .eq('user_id', user.id)
          .maybeSingle()
        if (staffError) throw staffError
        if (!staff) {
          const identity = await getCitizenIdentity()
          if (active && identity.profile) setState({ status: 'citizen' })
          return
        }
        if (!staff.active || !staff.approved || staff.force_password_change) {
          if (active) setState({ status: 'blocked' })
          return
        }

        const { data: assignments, error: assignmentsError } = await client
          .from('staff_ward_assignments')
          .select('ward_id')
          .eq('staff_user_id', user.id)
        if (assignmentsError) throw assignmentsError
        const wardIds = assignments.map(assignment => assignment.ward_id)
        let wards = []
        if (wardIds.length) {
          const { data, error } = await client
            .from('wards')
            .select('id, ward_number, ward_name')
            .in('id', wardIds)
            .eq('is_active', true)
          if (error) throw error
          wards = data || []
        }
        if (staff.role !== 'administrator' && !wards.length) {
          if (active) setState({ status: 'no-wards' })
          return
        }
        if (active) setState({ status: 'authorized', staff, wards })
      } catch (error) {
        if (active) setState({ status: 'error', message: error.message || 'Unable to verify staff authorization.' })
      }
    }
    loadDashboard()
    return () => { active = false }
  }, [])

  if (state.status === 'loading') return <Layout><LoadingPage text="Verifying staff authorization…" /></Layout>
  if (state.status === 'unauthenticated') return <Navigate to="/staff-login" replace />
  if (state.status === 'citizen') return <Navigate to="/complaints/new" replace />
  if (state.status !== 'authorized') {
    return (
      <Layout>
        <section className="result-card">
          <p className="eyebrow">Staff access</p>
          <h1>Access could not be verified</h1>
          <p className="notice notice-error" role="alert">
            {state.status === 'blocked' ? 'This account is inactive, unapproved, or must change its password before access.' :
              state.status === 'no-wards' ? 'No active ward assignment is available for this account. Contact an administrator.' :
                state.message || 'Please sign in with an authorized municipal staff account.'}
          </p>
          <button className="button button-secondary" type="button" onClick={async () => { await requireSupabase().auth.signOut(); navigate('/staff-login', { replace: true }) }}>Return to staff login</button>
        </section>
      </Layout>
    )
  }

  return (
    <Layout>
      <section className="details-card staff-dashboard">
        <p className="eyebrow">Authorized staff dashboard</p>
        <h1>Municipal Staff Access</h1>
        <p>Your access is verified from your authenticated staff profile and current ward assignments.</p>
        <dl className="details-list">
          <div><dt>Role</dt><dd>{state.staff.role}</dd></div>
          <div><dt>Department ID</dt><dd>{state.staff.department_id}</dd></div>
          <div><dt>Authorized wards</dt><dd>{state.staff.role === 'administrator' ? 'Administrator access across wards' : state.wards.map(ward => `Ward ${String(ward.ward_number).padStart(2, '0')}`).join(', ')}</dd></div>
        </dl>
        <p className="field-hint">Complaint routing and staff work queues are not configured in the current application.</p>
        <button className="button button-secondary" type="button" onClick={async () => { await requireSupabase().auth.signOut(); navigate('/', { replace: true }) }}>Sign out</button>
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
