const configuredApiUrl = import.meta.env.VITE_API_URL?.trim()

export const apiUrl = (configuredApiUrl || (import.meta.env.DEV ? 'http://localhost:5000' : ''))
  .replace(/\/+$/, '')

export function requireApiUrl() {
  if (!apiUrl) {
    const error = new Error('The application API URL is not configured. Set VITE_API_URL in Vercel and redeploy the frontend.')
    error.code = 'API_URL_MISSING'
    throw error
  }
  try {
    const url = new URL(apiUrl)
    if (!['https:', 'http:'].includes(url.protocol) ||
        (url.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(url.hostname)) ||
        url.pathname !== '/' || url.search || url.hash) {
      throw new Error('invalid')
    }
  } catch {
    const error = new Error('VITE_API_URL must be the HTTPS origin of the Express service, without an /api path.')
    error.code = 'API_URL_INVALID'
    throw error
  }
  return apiUrl
}
