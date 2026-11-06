function redact(value, sensitiveValues) {
  let message = String(value || '')
  for (const sensitiveValue of sensitiveValues) {
    if (typeof sensitiveValue === 'string' && sensitiveValue.length > 0) {
      message = message.replaceAll(sensitiveValue, '[redacted]')
    }
  }
  return message
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted-email]')
    .replace(/\b(?:\+?\d[\d\s().-]{8,}\d)\b/g, '[redacted-number]')
    .replace(/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+/gi, '[redacted-key]')
    .replace(/\beyJ[A-Za-z0-9._-]+/g, '[redacted-token]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 300)
}

function failureType(error) {
  const causeCode = error?.cause?.code || error?.code
  const name = error?.name || error?.cause?.name
  const message = `${error?.message || ''} ${error?.cause?.message || ''}`

  if (name === 'TimeoutError' || name === 'AbortError' ||
      ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'].includes(causeCode)) return 'timeout'
  if (['ENOTFOUND', 'EAI_AGAIN', 'ENODATA'].includes(causeCode)) return 'dns'
  if (/^(CERT_|ERR_TLS|ERR_SSL|UNABLE_TO_VERIFY_LEAF_SIGNATURE)/.test(causeCode || '') ||
      /certificate|tls|ssl/i.test(message)) return 'tls'
  if ([
    'ERR_INVALID_URL',
    'ERR_INVALID_ARG_VALUE',
    'ERR_INVALID_CHAR',
    'ERR_HTTP_INVALID_HEADER_VALUE',
  ].includes(error?.code) || /invalid (url|header)|header name/i.test(message)) {
    return 'request_construction'
  }
  return 'network'
}

function errorDiagnostic(error, sensitiveValues, { requestInitiated, host, path }) {
  const cause = error?.cause
  return {
    failureType: failureType(error),
    exceptionName: redact(error?.name || 'Error', sensitiveValues),
    exceptionMessage: redact(error?.message, sensitiveValues),
    causeName: cause?.name ? redact(cause.name, sensitiveValues) : null,
    causeCode: cause?.code ? redact(cause.code, sensitiveValues) : null,
    requestInitiated,
    httpResponseReceived: false,
    status: null,
    host,
    path,
  }
}

export async function requestAuthAdminUser(config, payload, {
  fetchImpl = fetch,
  timeoutMs = 10000,
} = {}) {
  const sensitiveValues = [
    config.secretKey,
    payload.password,
    payload.email,
    payload.phone,
    payload.user_metadata?.full_name,
    payload.user_metadata?.username,
  ]
  let endpoint
  try {
    endpoint = new URL('/auth/v1/admin/users', config.url)
  } catch (error) {
    const diagnostic = errorDiagnostic(error, sensitiveValues, {
      requestInitiated: false,
      host: null,
      path: '/auth/v1/admin/users',
    })
    const requestError = new Error('Supabase Auth request URL could not be constructed.')
    requestError.code = 'AUTH_REQUEST_CONSTRUCTION_FAILED'
    requestError.diagnostic = diagnostic
    throw requestError
  }

  const requestUrl = `${endpoint.origin}${endpoint.pathname}`
  let signal
  try {
    signal = AbortSignal.timeout(timeoutMs)
  } catch (error) {
    const diagnostic = errorDiagnostic(error, sensitiveValues, {
      requestInitiated: false,
      host: endpoint.hostname,
      path: endpoint.pathname,
    })
    const requestError = new Error('Supabase Auth request timeout could not be configured.')
    requestError.code = 'AUTH_REQUEST_CONSTRUCTION_FAILED'
    requestError.diagnostic = diagnostic
    throw requestError
  }

  try {
    const response = await fetchImpl(requestUrl, {
      method: 'POST',
      headers: {
        apikey: config.secretKey,
        authorization: `Bearer ${config.secretKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal,
    })
    return { response, host: endpoint.hostname, path: endpoint.pathname }
  } catch (error) {
    const diagnostic = errorDiagnostic(error, sensitiveValues, {
      requestInitiated: true,
      host: endpoint.hostname,
      path: endpoint.pathname,
    })
    const requestError = new Error('Supabase Auth request failed before receiving a response.')
    requestError.code = diagnostic.failureType === 'request_construction'
      ? 'AUTH_REQUEST_CONSTRUCTION_FAILED'
      : 'AUTH_SERVICE_UNAVAILABLE'
    requestError.diagnostic = diagnostic
    throw requestError
  }
}

export function safeAuthResponseDetails(payload, sensitiveValues = []) {
  const code = typeof payload?.code === 'string'
    ? redact(payload.code, sensitiveValues)
    : null
  const rawMessage = [payload?.message, payload?.msg, payload?.error, payload?.error_description]
    .find(value => typeof value === 'string')
  return {
    code,
    message: rawMessage ? redact(rawMessage, sensitiveValues) : null,
  }
}
