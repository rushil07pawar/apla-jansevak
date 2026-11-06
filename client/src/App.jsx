import { useEffect, useRef, useState } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, CheckCircle2, Eye, EyeOff, ImagePlus, LogIn, MapPin, RefreshCw, Search, ShieldCheck, UserPlus } from 'lucide-react'
import { getCitizenIdentity, getMainAdministratorSetupStatus, registerCitizen, setupMainAdministrator, signInCitizen, signInStaff } from './lib/auth'
import { complaintCategories, getComplaint, submitComplaint } from './lib/complaints'
import { createAdminDepartment, createStaffAccount, createStaffDesignation, deleteAdminSystemSetting, getAdminAuditLogs, getAdminDashboard, getAdminDepartments, getAdminDesignations, getAdminStaff, getAdminSystemSettings, getAdminWards, getStaffDashboard, saveAdminSystemSetting, setAdminStaffPassword, setStaffAccountActive, setStaffDesignationActive, takeComplaintAction, updateAdminDepartment, updateStaffAccount, updateStaffDesignation } from './lib/staffManagement'
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
  const [showPassword, setShowPassword] = useState(false)
  const [showRecoveryHelp, setShowRecoveryHelp] = useState(false)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()

  async function handleSubmit(event) {
    event.preventDefault()
    if (!/^[6-9][0-9]{9}$/.test(mobile)) {
      setMessage('Enter a valid Indian mobile number using exactly 10 digits, without +91.')
      return
    }
    setBusy(true)
    setMessage('')
    try {
      const { staff } = await signInStaff({ mobile, password })
      navigate(
        staff.is_main_system_admin === true && staff.role === 'administrator'
          ? '/admin-dashboard'
          : '/staff/dashboard',
        { replace: true },
      )
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
          <p>Staff and the Main System Administrator use their registered 10-digit mobile number and password here. Administrator access is verified securely after sign-in.</p>
        </div>
        <form className="form-card" onSubmit={handleSubmit} noValidate>
          <label className="field">
            <span>Registered mobile number</span>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="username"
              placeholder="9876543210"
              pattern="[6-9][0-9]{9}"
              maxLength={10}
              value={mobile}
              onChange={event => setMobile(event.target.value)}
              aria-invalid={Boolean(mobile) && !/^[6-9][0-9]{0,9}$/.test(mobile)}
              required
            />
            <small className="field-hint">Enter exactly 10 digits, without +91, spaces, or symbols.</small>
          </label>
          <label className="field"><span>Password</span><span className="password-input-wrap"><input type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required /><button className="password-visibility" type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword}>{showPassword ? <EyeOff size={19} /> : <Eye size={19} />}</button></span></label>
          <button className="button button-primary form-submit" type="submit" disabled={busy || !mobile || !password}>{busy ? 'Please wait…' : 'Staff Login'} <ArrowRight size={18} /></button>
          <button className="text-button recovery-button" type="button" onClick={() => setShowRecoveryHelp(value => !value)}>Forgot password?</button>
          {showRecoveryHelp && <p className="notice" role="status">For security, staff password resets are handled by the Main System Administrator. Contact your authorized administrator; they can set a new password from Staff Management.</p>}
          {message && <p className="notice notice-error" role="alert">{message}</p>}
        </form>
      </section>
    </Layout>
  )
}

function AdminSetup() {
  const [setupState, setSetupState] = useState({ status: 'checking' })
  const [values, setValues] = useState({
    fullName: '',
    username: '',
    mobile: '',
    email: '',
    password: '',
    confirmPassword: '',
    setupKey: '',
  })
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [showSetupKey, setShowSetupKey] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    getMainAdministratorSetupStatus()
      .then(result => {
        if (active) setSetupState({ status: result.available ? 'open' : result.reason || 'closed' })
      })
      .catch(error => {
        if (active) setSetupState({ status: error.code || 'unavailable', message: error.message })
      })
    return () => { active = false }
  }, [])

  function updateValue(field, value) {
    setValues(current => ({ ...current, [field]: value }))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    const name = values.fullName.trim()
    const username = values.username.trim().toLowerCase()
    const mobile = values.mobile.trim()
    const email = values.email.trim().toLowerCase()
    if (name.length < 2 || name.length > 100 ||
        !/^[a-z0-9_]{3,30}$/.test(username) ||
        !/^[6-9][0-9]{9}$/.test(mobile) ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        values.password.length < 12 || values.password.length > 128 ||
        values.password !== values.confirmPassword ||
        !values.setupKey) {
      setSetupState({
        status: 'open',
        message: 'Check the name, username, 10-digit mobile, email, matching 12–128 character passwords, and setup key.',
      })
      return
    }
    setBusy(true)
    setSetupState({ status: 'submitting' })
    try {
      const result = await setupMainAdministrator({
        ...values,
        fullName: name,
        username,
        mobile,
        email,
      })
      setSetupState({ status: 'success', message: result.message })
    } catch (error) {
      let status = error.status === 409 ? 'closed' : error.code || 'open'
      try {
        const latest = await getMainAdministratorSetupStatus()
        if (!latest.available) status = latest.reason || 'closed'
      } catch {
        status = error.status === 409 ? 'closed' : error.code || 'unavailable'
      }
      setSetupState({
        status,
        message: error.message || 'Unable to complete setup.',
      })
    } finally {
      setBusy(false)
    }
  }

  const setupStatus = String(setupState.status)
  const supabaseUnavailable = setupStatus.startsWith('SUPABASE_') ||
    setupStatus === 'supabase_unavailable'
  const apiUnavailable = ['API_UNREACHABLE', 'API_URL_MISSING', 'API_URL_INVALID'].includes(setupStatus)

  return (
    <Layout>
      <section className="auth-page">
        <div className="auth-intro">
          <p className="eyebrow">One-time secure setup</p>
          <h1>AplaJansevak — Main Administrator Setup</h1>
          <p>Creates the first global administrator only. The server and database permanently close setup after that account is created.</p>
          <p><strong>Designation:</strong> Developer / Main System Administrator</p>
        </div>
        <div className="form-card">
          {setupState.status === 'checking' || setupState.status === 'submitting' ? (
            <LoadingPage text={setupState.status === 'checking' ? 'Checking secure setup status…' : 'Creating the first administrator…'} />
          ) : setupState.status === 'success' ? (
            <>
              <h2>Initial setup complete</h2>
              <p className="notice notice-success" role="status">{setupState.message}</p>
              <p>Administrator registration is now closed. Sign in with the mobile number and password you just registered.</p>
              <Link className="button button-primary form-submit" to="/staff-login">Go to Municipal Staff Login <ArrowRight size={18} /></Link>
            </>
          ) : setupState.status === 'open' ? (
            <form onSubmit={handleSubmit}>
              <label className="field"><span>Full name</span><input autoComplete="name" maxLength={100} value={values.fullName} onChange={event => updateValue('fullName', event.target.value)} required /></label>
              <label className="field"><span>Username</span><input autoComplete="username" minLength={3} maxLength={30} pattern="[A-Za-z0-9_]{3,30}" value={values.username} onChange={event => updateValue('username', event.target.value)} required /><small className="field-hint">Use 3–30 letters, numbers, or underscores.</small></label>
              <label className="field"><span>Registered 10-digit mobile number</span><input type="text" inputMode="numeric" autoComplete="tel-national" maxLength={10} pattern="[6-9][0-9]{9}" value={values.mobile} onChange={event => updateValue('mobile', event.target.value)} required /></label>
              <label className="field"><span>Email address</span><input type="email" autoComplete="email" maxLength={254} value={values.email} onChange={event => updateValue('email', event.target.value)} required /></label>
              <label className="field"><span>Password</span><span className="password-input-wrap"><input type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={12} maxLength={128} value={values.password} onChange={event => updateValue('password', event.target.value)} required /><button className="password-visibility" type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword}>{showPassword ? <EyeOff size={19} /> : <Eye size={19} />}</button></span><small className="field-hint">Use 12–128 characters.</small></label>
              <label className="field"><span>Confirm password</span><span className="password-input-wrap"><input type={showConfirmPassword ? 'text' : 'password'} autoComplete="new-password" minLength={12} maxLength={128} value={values.confirmPassword} onChange={event => updateValue('confirmPassword', event.target.value)} required /><button className="password-visibility" type="button" onClick={() => setShowConfirmPassword(value => !value)} aria-label={showConfirmPassword ? 'Hide confirmation' : 'Show confirmation'} aria-pressed={showConfirmPassword}>{showConfirmPassword ? <EyeOff size={19} /> : <Eye size={19} />}</button></span></label>
              <label className="field"><span>One-time administrator setup key</span><span className="password-input-wrap"><input type={showSetupKey ? 'text' : 'password'} autoComplete="off" minLength={32} value={values.setupKey} onChange={event => updateValue('setupKey', event.target.value)} required /><button className="password-visibility" type="button" onClick={() => setShowSetupKey(value => !value)} aria-label={showSetupKey ? 'Hide setup key' : 'Show setup key'} aria-pressed={showSetupKey}>{showSetupKey ? <EyeOff size={19} /> : <Eye size={19} />}</button></span><small className="field-hint">Enter the key configured privately on the Express server. Never share it in chat.</small></label>
              {setupState.message && <p className="notice notice-error" role="alert">{setupState.message}</p>}
              <button className="button button-primary form-submit" type="submit" disabled={busy}>Create Main System Administrator <ArrowRight size={18} /></button>
            </form>
          ) : (
            <>
              <h2>{setupState.status === 'closed'
                ? 'Initial setup is closed'
                : supabaseUnavailable
                  ? 'Supabase connection unavailable'
                  : setupState.status === 'BACKEND_CONFIGURATION_MISSING'
                    ? 'Backend Supabase configuration unavailable'
                    : apiUnavailable
                    ? 'Application API unavailable'
                    : 'Setup is unavailable'}</h2>
              <p className="notice notice-error" role="alert">{setupState.status === 'closed'
                ? setupState.message || 'A Main System Administrator already exists. This page cannot create or promote another account.'
                : setupState.message || 'The backend could not verify initial setup. Check its configuration and logs.'}</p>
              <Link className="button button-secondary" to="/staff-login">Go to Municipal Staff Login</Link>
            </>
          )}
        </div>
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

function StaffDashboard({ administratorOnly = false }) {
  const [state, setState] = useState({ status: 'loading' })
  const [onlyAssigned, setOnlyAssigned] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    let active = true
    const loadDashboard = administratorOnly
      ? getAdminDashboard
      : getStaffDashboard
    loadDashboard()
      .then(data => {
        if (!active) return
        if (administratorOnly && (
          data.staff.is_main_system_admin !== true ||
          data.staff.role !== 'administrator'
        )) {
          setState({ status: 'error', message: 'Main System Administrator access is required.' })
          return
        }
        setState({ status: 'authorized', ...data })
      })
      .catch(error => {
        if (active) setState({ status: 'error', message: error.message || 'Unable to verify staff authorization.' })
      })
    return () => { active = false }
  }, [administratorOnly])

  async function runAction(complaintId, action) {
    setState(current => ({ ...current, busyId: complaintId, actionMessage: '' }))
    try {
      await takeComplaintAction(complaintId, action)
      const data = administratorOnly ? await getAdminDashboard() : await getStaffDashboard()
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

  if (administratorOnly && state.status === 'authorized' &&
      (state.staff.is_main_system_admin !== true || state.staff.role !== 'administrator')) {
    return <Layout><LoadingPage text="Verifying administrator authorization…" /></Layout>
  }

  if (!administratorOnly && state.status === 'authorized' &&
      state.staff.is_main_system_admin === true && state.staff.role === 'administrator') {
    return <Navigate to="/admin-dashboard" replace />
  }

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
        <p className="eyebrow">{administratorOnly ? 'Global administrator access' : 'Authorized staff dashboard'}</p>
        <h1>{administratorOnly ? 'Main System Administrator Dashboard' : 'Complaint Work Queue'}</h1>
        <p>{administratorOnly
          ? 'Global access to departments, wards, complaints, and staff administration is verified by the server and database.'
          : 'Complaint records are limited by your active department, ward, and database-authorized permissions.'}</p>
        <dl className="details-list">
          <div><dt>Staff member</dt><dd>{state.staff.full_name_mr || state.staff.full_name_en || state.staff.staff_id || 'Municipal staff'}</dd></div>
          <div><dt>Role</dt><dd>{state.staff.is_main_system_admin ? 'Main System Administrator' : STAFF_ROLE_LABELS[state.staff.role] || state.staff.role}</dd></div>
          <div><dt>Designation</dt><dd>{state.staff.designation_mr || state.staff.designation_en || 'Not recorded'}</dd></div>
          <div><dt>Department</dt><dd>{state.staff.is_main_system_admin ? 'Not applicable (global administrator)' : state.departments.find(department => department.id === state.staff.department_id)?.name || 'Not assigned'}</dd></div>
          <div><dt>Authorized wards</dt><dd>{state.staff.is_main_system_admin ? 'All wards' : state.staff.authorized_wards?.length ? state.staff.authorized_wards.map(ward => `Ward ${String(ward.ward_number).padStart(2, '0')}`).join(', ') : 'None assigned'}</dd></div>
          <div><dt>Reporting officer</dt><dd>{state.staff.reportsTo?.full_name_mr || state.staff.reportsTo?.full_name_en || state.staff.reportsTo?.staff_id || 'Not configured'}</dd></div>
        </dl>
        <div className="work-stat-grid">
          {[['Assigned to me', state.stats.assigned], ['Pending', state.stats.pending], ['Submitted', state.stats.submitted], ['In progress', state.stats.in_progress], ['Resolved', state.stats.resolved], ['Visible total', state.stats.total]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
        </div>
        {state.staff.is_main_system_admin && state.complaints.length > 0 && <div className="department-statistics"><h2>Department complaint counts</h2>{state.departments.map(department => {
          const count = state.complaints.filter(complaint => complaint.department_id === department.id).length
          return <p key={department.id}><strong>{department.name_mr}</strong> · {department.name}: {count}</p>
        })}{state.complaints.some(complaint => !complaint.department_id) && <p><strong>Unrouted (manual review required)</strong>: {state.complaints.filter(complaint => !complaint.department_id).length}</p>}<p className="field-hint">Overdue tracking is unavailable until an approved due-date/SLA rule exists.</p></div>}
        {state.staff.is_main_system_admin && <button className="button button-secondary" type="button" onClick={() => navigate('/staff/management')}>Open staff, department, settings, and audit management</button>}
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
    designation_id: '', department_id: '', mobile_e164: '', official_contact_number: '', role: 'assigned_staff',
    active: true, profile_verified: false, ward_ids: [], permissions: [], reports_to_user_id: '',
  }
}

function emptyDesignationProfile() {
  return { department_id: '', name_mr: '', name_en: '' }
}

function emptyDepartmentProfile() {
  return { code: '', name: '', name_mr: '' }
}

function emptySystemSetting() {
  return { key: '', description: '', value: '{\n  \n}' }
}

const STAFF_ROLE_LABELS = {
  administrator: 'Administrator (not Main System Administrator)',
  department_head: 'Department Head',
  supervising_officer: 'Supervising Officer',
  junior_section_officer: 'Junior / Section Officer',
  assigned_staff: 'Assigned Municipal Staff',
  supervisor: 'Supervisor (legacy)',
  staff: 'Staff (legacy)',
}

function StaffManagement() {
  const [state, setState] = useState({ status: 'loading', departments: [], designations: [], wards: [], staff: [], logs: [], settings: [] })
  const [profile, setProfile] = useState(emptyStaffProfile)
  const [designationProfile, setDesignationProfile] = useState(emptyDesignationProfile)
  const [departmentProfile, setDepartmentProfile] = useState(emptyDepartmentProfile)
  const [systemSetting, setSystemSetting] = useState(emptySystemSetting)
  const [editingId, setEditingId] = useState('')
  const [editingDesignationId, setEditingDesignationId] = useState('')
  const [editingDepartmentId, setEditingDepartmentId] = useState('')
  const [editingSystemSettingKey, setEditingSystemSettingKey] = useState('')
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
    const [departments, designations, wards, staff, logs, settings] = await Promise.all([
      getAdminDepartments(), getAdminDesignations(), getAdminWards(), getAdminStaff(), getAdminAuditLogs(), getAdminSystemSettings(),
    ])
    return { status: 'loaded', departments, designations, wards, staff, logs, settings }
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
      designation_id: state.designations.some(item => item.id === row.designation_id && item.is_active)
        ? row.designation_id
        : '',
      department_id: row.department_id,
      mobile_e164: row.mobile_e164.replace(/^\+91/, ''),
      official_contact_number: row.official_contact_number.replace(/^\+91/, ''),
      role: row.role,
      active: row.active,
      profile_verified: row.profile_verified,
      ward_ids: row.wards.map(ward => ward.id),
      permissions: row.permissions.map(permission => ({ permission_code: permission.permission_code, ward_id: permission.ward_id })),
      reports_to_user_id: row.reports_to_user_id || '',
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function editDesignation(designation) {
    setEditingDesignationId(designation.id)
    setDesignationProfile({
      department_id: designation.department_id,
      name_mr: designation.name_mr || '',
      name_en: designation.name_en || '',
    })
  }

  function editDepartment(department) {
    setEditingDepartmentId(department.id)
    setDepartmentProfile({
      code: department.code,
      name: department.name,
      name_mr: department.name_mr || '',
    })
  }

  function cancelDepartmentEdit() {
    setEditingDepartmentId('')
    setDepartmentProfile(emptyDepartmentProfile())
  }

  async function submitDepartment(event) {
    event.preventDefault()
    if (!window.confirm(`${editingDepartmentId ? 'Save changes to' : 'Add'} this department?`)) return
    setBusy(true)
    setMessage('')
    try {
      const result = editingDepartmentId
        ? await updateAdminDepartment(editingDepartmentId, departmentProfile)
        : await createAdminDepartment(departmentProfile)
      setMessage(result.message)
      cancelDepartmentEdit()
      await load()
    } catch (error) {
      setMessage(error.message || 'Unable to save this department.')
    } finally {
      setBusy(false)
    }
  }

  function editSystemSetting(setting) {
    setEditingSystemSettingKey(setting.key)
    setSystemSetting({
      key: setting.key,
      description: setting.description || '',
      value: JSON.stringify(setting.value, null, 2),
    })
  }

  function cancelSystemSettingEdit() {
    setEditingSystemSettingKey('')
    setSystemSetting(emptySystemSetting())
  }

  async function submitSystemSetting(event) {
    event.preventDefault()
    let value
    try {
      value = JSON.parse(systemSetting.value)
    } catch {
      setMessage('Enter a valid JSON value for this setting.')
      return
    }
    if (!window.confirm(`${editingSystemSettingKey ? 'Save changes to' : 'Add'} this system setting?`)) return
    setBusy(true)
    setMessage('')
    try {
      const result = await saveAdminSystemSetting(systemSetting.key, {
        value,
        description: systemSetting.description,
      })
      setMessage(result.message)
      cancelSystemSettingEdit()
      await load()
    } catch (error) {
      setMessage(error.message || 'Unable to save this system setting.')
    } finally {
      setBusy(false)
    }
  }

  async function removeSystemSetting(setting) {
    if (!window.confirm(`Delete the "${setting.key}" system setting? This action is recorded in the audit log.`)) return
    setBusy(true)
    setMessage('')
    try {
      const result = await deleteAdminSystemSetting(setting.key)
      setMessage(result.message)
      if (editingSystemSettingKey === setting.key) cancelSystemSettingEdit()
      await load()
    } catch (error) {
      setMessage(error.message || 'Unable to delete this system setting.')
    } finally {
      setBusy(false)
    }
  }

  function cancelDesignationEdit() {
    setEditingDesignationId('')
    setDesignationProfile(emptyDesignationProfile())
  }

  async function submitDesignation(event) {
    event.preventDefault()
    if (!window.confirm(`${editingDesignationId ? 'Save changes to' : 'Add'} this department designation?`)) return
    setBusy(true)
    setMessage('')
    try {
      const result = editingDesignationId
        ? await updateStaffDesignation(editingDesignationId, designationProfile)
        : await createStaffDesignation(designationProfile)
      setMessage(result.message)
      cancelDesignationEdit()
      await load()
    } catch (error) {
      setMessage(error.message || 'Unable to save this designation.')
    } finally {
      setBusy(false)
    }
  }

  async function toggleDesignationActive(designation) {
    if (!window.confirm(`${designation.is_active ? 'Deactivate' : 'Activate'} this designation?`)) return
    setBusy(true)
    try {
      const result = await setStaffDesignationActive(designation.id, !designation.is_active)
      setMessage(result.message)
      await load()
    } catch (error) {
      setMessage(error.message || 'Unable to change designation status.')
    } finally {
      setBusy(false)
    }
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
  const departmentDesignations = state.designations.filter(item => item.department_id === profile.department_id && item.is_active)

  function chooseDesignation(designationId) {
    const designation = departmentDesignations.find(item => item.id === designationId)
    setProfile(current => ({
      ...current,
      designation_id: designation?.id || '',
      designation_mr: designation?.name_mr || '',
      designation_en: designation?.name_en || '',
    }))
  }

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
        <div className="management-tabs" aria-label="Staff management sections"><button type="button" aria-pressed={tab === 'directory'} onClick={() => setTab('directory')}>Departments and staff</button><button type="button" aria-pressed={tab === 'settings'} onClick={() => setTab('settings')}>System settings</button><button type="button" aria-pressed={tab === 'audit'} onClick={() => setTab('audit')}>Audit log</button></div>
        {message && <p className="notice" role="status">{message}</p>}
        {tab === 'directory' ? <>
          <section className="form-card staff-editor">
            <h2>Departments</h2>
            <p className="field-hint">Add or update department records. Departments with staff or complaint data cannot be deleted.</p>
            <form className="management-form-grid" onSubmit={submitDepartment}>
              <label className="field"><span>Department code</span><input value={departmentProfile.code} onChange={event => setDepartmentProfile({ ...departmentProfile, code: event.target.value.toUpperCase() })} pattern="[A-Z0-9_]{2,32}" maxLength={32} required /></label>
              <label className="field"><span>Department name (English)</span><input value={departmentProfile.name} onChange={event => setDepartmentProfile({ ...departmentProfile, name: event.target.value })} minLength={2} maxLength={120} required /></label>
              <label className="field"><span>Department name (Marathi)</span><input value={departmentProfile.name_mr} onChange={event => setDepartmentProfile({ ...departmentProfile, name_mr: event.target.value })} maxLength={180} /></label>
              <div className="editor-actions"><button className="button button-primary" type="submit" disabled={busy || departmentProfile.code.length < 2 || departmentProfile.name.trim().length < 2}>{busy ? 'Saving…' : editingDepartmentId ? 'Save department' : 'Add department'}</button>{editingDepartmentId && <button className="button button-secondary" type="button" onClick={cancelDepartmentEdit}>Cancel</button>}</div>
            </form>
            <div className="designation-list">{state.departments.map(department => <article className="directory-person" key={department.id}><div><strong>{department.name_mr || department.name}</strong>{department.name_mr && <span>{department.name}</span>}<small>{department.code}</small></div><div className="directory-actions"><button type="button" className="text-button" disabled={busy} onClick={() => editDepartment(department)}>Edit</button></div></article>)}</div>
          </section>
          <section className="form-card staff-editor">
            <h2>Department designations</h2>
            <p className="field-hint">Maintain the designation choices available when creating staff profiles. Add only titles verified against official municipal records.</p>
            <form className="management-form-grid" onSubmit={submitDesignation}>
              <label className="field"><span>Department</span><select required value={designationProfile.department_id} onChange={event => setDesignationProfile({ ...designationProfile, department_id: event.target.value })}><option value="">Select department</option>{state.departments.map(department => <option key={department.id} value={department.id}>{department.name_mr} · {department.name}</option>)}</select></label>
              <label className="field"><span>Designation (Marathi)</span><input value={designationProfile.name_mr} onChange={event => setDesignationProfile({ ...designationProfile, name_mr: event.target.value })} maxLength={180} /></label>
              <label className="field"><span>Designation (English)</span><input value={designationProfile.name_en} onChange={event => setDesignationProfile({ ...designationProfile, name_en: event.target.value })} maxLength={180} /></label>
              <div className="editor-actions"><button className="button button-primary" type="submit" disabled={busy || !designationProfile.department_id || (!designationProfile.name_mr.trim() && !designationProfile.name_en.trim())}>{busy ? 'Saving…' : editingDesignationId ? 'Save designation' : 'Add designation'}</button>{editingDesignationId && <button className="button button-secondary" type="button" onClick={cancelDesignationEdit}>Cancel</button>}</div>
            </form>
            <div className="designation-list">{state.designations.map(designation => {
              const department = state.departments.find(item => item.id === designation.department_id)
              return <article className="directory-person" key={designation.id}><div><strong>{designation.name_mr || designation.name_en}</strong>{designation.name_mr && designation.name_en && <span>{designation.name_en}</span>}<small>{department?.name || 'Department'}</small></div><span className={designation.is_active ? 'staff-status status-active' : 'staff-status'}>{designation.is_active ? 'Active' : 'Inactive'}</span><div className="directory-actions"><button type="button" className="text-button" disabled={busy} onClick={() => editDesignation(designation)}>Edit</button><button type="button" className="text-button" disabled={busy} onClick={() => toggleDesignationActive(designation)}>{designation.is_active ? 'Deactivate' : 'Activate'}</button></div></article>
            })}</div>
          </section>
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
              <label className="field"><span>Department</span><select required value={profile.department_id} onChange={event => setProfile({ ...profile, department_id: event.target.value, designation_id: '', designation_mr: '', designation_en: '', reports_to_user_id: '' })}><option value="">Select department</option>{state.departments.map(department => <option key={department.id} value={department.id}>{department.name_mr} · {department.name}</option>)}</select></label>
              <label className="field"><span>Full name (Marathi)</span><input value={profile.full_name_mr} onChange={event => setProfile({ ...profile, full_name_mr: event.target.value })} /></label>
              <label className="field"><span>Full name (English)</span><input value={profile.full_name_en} onChange={event => setProfile({ ...profile, full_name_en: event.target.value })} /></label>
              <label className="field"><span>Configured designation</span><select required={!editingId} value={profile.designation_id} onChange={event => chooseDesignation(event.target.value)}><option value="">{editingId ? 'Keep existing designation' : 'Select designation'}</option>{departmentDesignations.map(designation => <option key={designation.id} value={designation.id}>{designation.name_mr}{designation.name_mr && designation.name_en ? ' · ' : ''}{designation.name_en}</option>)}</select><small className="field-hint">{editingId && !profile.designation_id ? `Existing: ${profile.designation_mr || profile.designation_en}. Choose a configured title to replace it.` : 'Add a verified designation above if the correct title is not listed.'}</small></label>
              <label className="field"><span>Staff login mobile (10 digits)</span><input type="text" inputMode="numeric" placeholder="9876543210" pattern="[6-9][0-9]{9}" maxLength={10} required disabled={Boolean(editingId)} value={profile.mobile_e164} onChange={event => setProfile({ ...profile, mobile_e164: event.target.value })} /><small className="field-hint">Enter exactly 10 digits. The server stores it in Supabase's normalized +91 format.</small></label>
              {!editingId && <>
                <label className="field"><span>Password (12–128 characters)</span><input type="password" autoComplete="new-password" minLength="12" maxLength="128" required value={initialPassword} onChange={event => setInitialPassword(event.target.value)} /></label>
                <label className="field"><span>Confirm password</span><input type="password" autoComplete="new-password" minLength="12" maxLength="128" required value={confirmInitialPassword} onChange={event => setConfirmInitialPassword(event.target.value)} /></label>
              </>}
              <label className="field"><span>Official contact number (10 digits)</span><input type="text" inputMode="numeric" placeholder="9876543210" pattern="[6-9][0-9]{9}" maxLength={10} value={profile.official_contact_number} onChange={event => setProfile({ ...profile, official_contact_number: event.target.value })} /><small className="field-hint">Enter exactly 10 digits; this number is not shown to citizens.</small></label>
              <label className="field"><span>Account role</span><select value={profile.role} onChange={event => setProfile({ ...profile, role: event.target.value })}>{Object.entries(STAFF_ROLE_LABELS).filter(([value]) => ['department_head', 'supervising_officer', 'junior_section_officer', 'assigned_staff'].includes(value) || (editingId && value === profile.role)).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><small className="field-hint">Role labels do not grant access by themselves. Ward-scoped permissions below are enforced by the database. Administrator and legacy roles cannot be assigned to new accounts.</small></label>
              <label className="field"><span>Reporting officer</span><select value={profile.reports_to_user_id} onChange={event => setProfile({ ...profile, reports_to_user_id: event.target.value })}><option value="">No reporting officer configured</option>{state.staff.filter(row => row.department_id === profile.department_id && row.user_id !== editingId && row.active && row.approved && !row.force_password_change).map(row => <option key={row.user_id} value={row.user_id}>{row.full_name_mr || row.full_name_en || row.staff_id}</option>)}</select></label>
            </div>
            <fieldset className="management-fieldset"><legend>Authorized wards</legend><div className="ward-checkboxes">{state.wards.map(ward => <label key={ward.id}><input type="checkbox" checked={profile.ward_ids.includes(ward.id)} disabled={!ward.is_active && !profile.ward_ids.includes(ward.id)} onChange={() => toggleWard(ward.id)} /> Ward {String(ward.ward_number).padStart(2, '0')} · {ward.ward_name}{!ward.is_active && ' (inactive)'}</label>)}</div></fieldset>
            <fieldset className="management-fieldset"><legend>Permissions by assigned ward</legend>{profile.ward_ids.map(wardId => {
              const ward = state.wards.find(item => item.id === wardId)
              return <div className="permission-ward" key={wardId}><strong>Ward {String(ward?.ward_number || '').padStart(2, '0')}</strong><div className="permission-checkboxes">{permissionNames.map(([code, label]) => <label key={code}><input type="checkbox" checked={profile.permissions.some(item => item.ward_id === wardId && item.permission_code === code)} onChange={() => togglePermission(wardId, code)} />{label}</label>)}</div></div>
            })}{!profile.ward_ids.length && <p className="field-hint">Choose wards before granting complaint permissions.</p>}</fieldset>
            <label className="verification-check"><input type="checkbox" checked={profile.profile_verified} onChange={event => setProfile({ ...profile, profile_verified: event.target.checked })} /><span>Names, staff ID, designation, and reporting details have been verified against the official directory. Unverified profiles remain unapproved.</span></label>
            <label className="verification-check"><input type="checkbox" checked={profile.active} onChange={event => setProfile({ ...profile, active: event.target.checked })} /><span>Account active</span></label>
            <div className="editor-actions"><button className="button button-primary" type="submit" disabled={busy || !profile.department_id || !profile.mobile_e164 || (!editingId && !profile.designation_id)}>{busy ? 'Saving…' : editingId ? 'Save staff changes' : 'Create staff account'}</button>{editingId && <button className="button button-secondary" type="button" onClick={cancelEdit}>Cancel</button>}</div>
          </form>
          <div className="directory-controls">
            <label className="field"><span>Search staff by name, ID, or designation</span><div className="search-field"><Search size={18} /><input value={search} onChange={event => setSearch(event.target.value)} /></div></label>
            <label className="field"><span>Filter department</span><select value={departmentFilter} onChange={event => setDepartmentFilter(event.target.value)}><option value="">All departments</option>{state.departments.map(department => <option key={department.id} value={department.id}>{department.name_mr} · {department.name}</option>)}</select></label>
          </div>
          <div className="department-directory">{state.departments.filter(department => !departmentFilter || department.id === departmentFilter).map(department => {
            const rows = visibleStaff.filter(row => row.department_id === department.id)
            return <section className="department-card" key={department.id}><h2>{department.name_mr}</h2><p>{department.name}</p>{rows.length ? renderHierarchy(rows) : <p className="field-hint">No directory entries match this filter. Add staff only from a verified official source.</p>}</section>
          })}{!departmentFilter && state.staff.filter(row => row.is_main_system_admin).map(row => <section className="department-card" key={row.user_id}><h2>Global Main System Administrator</h2><article className="directory-person"><div><strong>{row.full_name_mr || row.full_name_en || 'Name not recorded'}</strong><small>{row.designation_mr || row.designation_en || 'Developer / Main System Administrator'}</small><small>No department · All wards</small><small>Login mobile: {row.mobile_e164}</small></div><span className={row.active && row.approved ? 'staff-status status-active' : 'staff-status'}>{row.active && row.approved ? 'Active' : 'Inactive'}</span></article></section>)}</div>
        </> : tab === 'settings' ? <>
          <form className="form-card staff-editor" onSubmit={submitSystemSetting}>
            <h2>{editingSystemSettingKey ? 'Edit system setting' : 'Add system setting'}</h2>
            <p className="field-hint">Settings are JSON values visible to administrators. Never store passwords, API keys, or other secrets here.</p>
            <div className="management-form-grid">
              <label className="field"><span>Setting key</span><input value={systemSetting.key} onChange={event => setSystemSetting({ ...systemSetting, key: event.target.value })} pattern="[a-z][a-z0-9_.-]{0,99}" maxLength={100} disabled={Boolean(editingSystemSettingKey)} required /></label>
              <label className="field"><span>Description</span><input value={systemSetting.description} onChange={event => setSystemSetting({ ...systemSetting, description: event.target.value })} maxLength={500} /></label>
              <label className="field"><span>JSON value</span><textarea value={systemSetting.value} onChange={event => setSystemSetting({ ...systemSetting, value: event.target.value })} maxLength={65536} required spellCheck="false" /></label>
            </div>
            <div className="editor-actions"><button className="button button-primary" type="submit" disabled={busy || !systemSetting.key || !systemSetting.value.trim()}>{busy ? 'Saving…' : editingSystemSettingKey ? 'Save setting' : 'Add setting'}</button>{editingSystemSettingKey && <button className="button button-secondary" type="button" onClick={cancelSystemSettingEdit}>Cancel</button>}</div>
          </form>
          <section className="audit-list"><h2>Configured settings</h2>{state.settings.length ? state.settings.map(setting => <article key={setting.key}><strong>{setting.key}</strong><span>{setting.description || 'No description'}</span><time>Updated {new Date(setting.updated_at).toLocaleString()}</time><pre>{JSON.stringify(setting.value, null, 2)}</pre><div className="directory-actions"><button type="button" className="text-button" disabled={busy} onClick={() => editSystemSetting(setting)}>Edit</button><button type="button" className="text-button" disabled={busy} onClick={() => removeSystemSetting(setting)}>Delete</button></div></article>) : <p>No system settings configured.</p>}</section>
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
      <Route path="/admin-setup" element={<AdminSetup />} />
      <Route path="/staff/dashboard" element={<StaffDashboard />} />
      <Route path="/admin-dashboard" element={<StaffDashboard administratorOnly />} />
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
