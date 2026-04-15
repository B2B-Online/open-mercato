import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import { validateCredentials } from '../../lib/credentials'
import { createB2BApiDbClient } from '../../lib/db-client'
import { createB2BApiCatalogImporter } from '../../lib/catalog-importer'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['data_sync.configure'] },
}

export const openApi = {
  tags: ['B2BAPI'],
  summary: 'Import a single product by ishark product ID',
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ ok: false, message: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, message: 'Invalid JSON body' }, { status: 400 })
  }

  const productId = body && typeof body === 'object' && 'productId' in body
    ? Number((body as Record<string, unknown>).productId)
    : NaN

  if (!Number.isInteger(productId) || productId <= 0) {
    return NextResponse.json({ ok: false, message: 'productId must be a positive integer' }, { status: 400 })
  }

  const container = await createRequestContainer()
  const credentialsService = container.resolve('integrationCredentialsService') as CredentialsService

  let raw: Record<string, unknown> | null
  try {
    raw = await credentialsService.getRaw('sync_b2bapi', {
      organizationId: auth.orgId as string,
      tenantId: auth.tenantId,
    })
  } catch {
    return NextResponse.json(
      { ok: false, message: 'Failed to read credentials (encryption service unavailable). Check Vault/KMS configuration.' },
      { status: 503 },
    )
  }

  if (!raw) {
    return NextResponse.json(
      { ok: false, message: 'No B2BAPI credentials configured. Set them up in Integrations → B2BAPI Product Sync.' },
      { status: 422 },
    )
  }

  let credentials
  try {
    credentials = validateCredentials(raw)
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : 'Invalid credentials' },
      { status: 422 },
    )
  }

  const client = createB2BApiDbClient(credentials)
  try {
    const row = await client.queryProductById({
      frontendId: credentials.frontendId,
      productId,
    })

    if (!row) {
      return NextResponse.json(
        { ok: false, message: `Product id=${productId} not found for frontendId=${credentials.frontendId}` },
        { status: 404 },
      )
    }

    const importer = await createB2BApiCatalogImporter(
      { organizationId: auth.orgId as string, tenantId: auth.tenantId },
    )
    const items = await importer.upsertProduct(row, {})

    return NextResponse.json({
      ok: true,
      productId,
      symbol: row.symbol,
      name: row.name,
      items: items.map((item) => ({ externalId: item.externalId, action: item.action })),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Import failed'
    const isConnError = message.includes('ENOTFOUND') || message.includes('ECONNREFUSED') || message.includes('connect')
    const friendlyMessage = isConnError
      ? `Cannot connect to ishark database (${credentials.dbHost}:${credentials.dbPort}). Check network access or use an SSH tunnel.`
      : message
    return NextResponse.json({ ok: false, message: friendlyMessage }, { status: 500 })
  } finally {
    await client.close()
  }
}
