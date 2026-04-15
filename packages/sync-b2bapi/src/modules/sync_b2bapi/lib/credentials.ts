export interface B2BApiCredentials {
  dbHost: string
  dbPort: number
  dbName: string
  dbUser: string
  dbPassword: string
  frontendId: number
  pricingApiUrl: string
  pricingApiKey: string
  gci: string
  pricingPriority?: number
  pricingCacheTtlSeconds?: number
}

const REQUIRED_FIELDS: ReadonlyArray<keyof B2BApiCredentials> = [
  'dbHost',
  'dbPort',
  'dbName',
  'dbUser',
  'dbPassword',
  'frontendId',
  'pricingApiUrl',
  'pricingApiKey',
  'gci',
]

export function validateCredentials(credentials: unknown): B2BApiCredentials {
  if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials)) {
    throw new Error('B2BApiCredentials must be a plain object')
  }

  const creds = credentials as Record<string, unknown>
  const missing: string[] = []

  for (const field of REQUIRED_FIELDS) {
    const value = creds[field]
    if (value === undefined || value === null || value === '') {
      missing.push(field)
    }
  }

  if (missing.length > 0) {
    throw new Error(`B2BApiCredentials missing required fields: ${missing.join(', ')}`)
  }

  return creds as unknown as B2BApiCredentials
}
