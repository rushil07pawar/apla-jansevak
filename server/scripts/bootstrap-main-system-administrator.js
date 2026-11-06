import 'dotenv/config'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { randomUUID } from 'node:crypto'
import { normalizeIndianMobile, staffAuthConfig } from '../src/lib/staffAuth.js'

let ignoreLineFeed = false

function readHidden(prompt) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    throw new Error('Run this setup command in an interactive terminal so the password can be hidden.')
  }

  stdout.write(prompt)
  stdin.setRawMode(true)
  stdin.resume()

  return new Promise((resolve, reject) => {
    let value = ''
    const finish = (error) => {
      stdin.off('data', onData)
      stdin.setRawMode(false)
      stdin.pause()
      stdout.write('\n')
      if (error) reject(error)
      else resolve(value)
    }
    const onData = chunk => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\u0003') return finish(new Error('Setup cancelled.'))
        if (character === '\r') {
          ignoreLineFeed = true
          return finish()
        }
        if (character === '\n') {
          if (ignoreLineFeed) {
            ignoreLineFeed = false
            continue
          }
          return finish()
        }
        ignoreLineFeed = false
        if (character === '\u0008' || character === '\u007f') {
          value = value.slice(0, -1)
        } else if (character >= ' ') {
          value += character
        }
      }
    }
    stdin.on('data', onData)
  })
}

async function supabaseRequest(config, path, body, method = 'POST') {
  const response = await fetch(`${config.url}${path}`, {
    method,
    headers: {
      apikey: config.secretKey,
      authorization: `Bearer ${config.secretKey}`,
      'content-type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const error = new Error(`Supabase request failed (${response.status}).`)
    error.status = response.status
    throw error
  }
  return data
}

async function main() {
  const config = staffAuthConfig()
  if (!config) {
    throw new Error('Set SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, and the server-only SUPABASE_SECRET_KEY first.')
  }

  const readline = createInterface({ input: stdin, output: stdout })
  let fullName
  let mobileInput
  try {
    fullName = (await readline.question('Full name: ')).trim()
    mobileInput = (await readline.question('Mobile number (10 digits): ')).trim()
  } finally {
    readline.close()
  }

  if (fullName.length < 2 || fullName.length > 100) {
    throw new Error('Enter a full name between 2 and 100 characters.')
  }
  const mobile = normalizeIndianMobile(mobileInput)
  if (!mobile) throw new Error('Enter a valid Indian mobile number using exactly 10 digits.')

  const password = await readHidden('New password (12–128 characters, input hidden): ')
  const passwordConfirmation = await readHidden('Confirm password (input hidden): ')
  if (password.length < 12 || password.length > 128 || password !== passwordConfirmation) {
    throw new Error('Passwords must match and be between 12 and 128 characters.')
  }

  const claimId = randomUUID()
  await supabaseRequest(config, '/rest/v1/rpc/claim_main_system_administrator_setup', {
    p_claim_id: claimId,
  })

  let authUser
  try {
    authUser = await supabaseRequest(config, '/auth/v1/admin/users', {
      phone: mobile,
      phone_confirm: true,
      password,
      app_metadata: { account_type: 'staff' },
      user_metadata: { full_name: fullName },
    })
  } catch (error) {
    if (Number.isInteger(error.status) && error.status < 500) {
      await supabaseRequest(config, '/rest/v1/rpc/release_main_system_administrator_setup', {
        p_claim_id: claimId,
      })
    }
    throw error
  }
  if (!authUser?.id) {
    throw new Error('Supabase Auth did not return a user ID. Setup remains claimed for operator review; do not retry or create another account.')
  }

  const profile = await supabaseRequest(config, '/rest/v1/rpc/bootstrap_main_system_administrator', {
    p_user_id: authUser.id,
    p_full_name: fullName,
    p_claim_id: claimId,
  })
  if (profile?.user_id !== authUser.id ||
      profile.department_id !== null ||
      profile.role !== 'administrator' ||
      profile.is_main_system_admin !== true) {
    throw new Error('The bootstrap RPC returned an unexpected profile. The Auth account was preserved; request operator review.')
  }

  console.log('Global Main System Administrator created successfully. The phone is confirmed; no SMS was sent.')
  console.log('Department: Not applicable; ward scope: all wards.')
  console.log('Sign in at /admin-login using the 10-digit mobile number and password entered during setup.')
}

main().catch(error => {
  console.error(error.message)
  process.exitCode = 1
})
