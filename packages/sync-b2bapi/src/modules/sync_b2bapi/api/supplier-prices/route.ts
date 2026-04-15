import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['sales.manage'] },
}

export const openApi = {
  tags: ['B2BAPI'],
  summary: 'Fetch supplier prices for a product symbol from b2bapi',
}

interface SupplierProduct {
  pk: number
  supplier_name: string
  supplier_gci: string
  price_amount: number
  price_with_tax_amount: number
  quantity: number
  deleted: boolean
  sku: string
  symbol: string
  delivery_days: number | null
  next_delivery_date: string | null
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ ok: false, message: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const symbol = url.searchParams.get('symbol')

  if (!symbol) {
    return NextResponse.json({ ok: false, message: 'symbol query param is required' }, { status: 400 })
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
      { ok: false, message: 'Failed to read credentials (encryption service unavailable).' },
      { status: 503 },
    )
  }

  if (!raw) {
    return NextResponse.json(
      { ok: false, message: 'No B2BAPI credentials configured.' },
      { status: 422 },
    )
  }

  const pricingApiUrl = typeof raw.pricingApiUrl === 'string' ? raw.pricingApiUrl : null
  const pricingApiKey = typeof raw.pricingApiKey === 'string' ? raw.pricingApiKey : null
  const gci = typeof raw.gci === 'string' ? raw.gci : null

  if (!pricingApiUrl || !pricingApiKey || !gci) {
    return NextResponse.json(
      { ok: false, message: 'Incomplete B2BAPI credentials (pricingApiUrl, pricingApiKey, gci required).' },
      { status: 422 },
    )
  }

  try {
    const baseUrl = pricingApiUrl.replace(/\/$/, '')
    const apiUrl = `${baseUrl}/supplier/products/inventory-product/symbol/${encodeURIComponent(symbol)}/?format=json&view=full&gci=${encodeURIComponent(gci)}&translate=0`

    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${pricingApiKey}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) {
      return NextResponse.json(
        { ok: false, message: `B2BAPI returned ${response.status}` },
        { status: 502 },
      )
    }

    const data: SupplierProduct[] = await response.json()

    // Filter out deleted suppliers and map to clean response
    const suppliers = data
      .filter((item) => !item.deleted && item.price_amount > 0)
      .map((item) => ({
        pk: item.pk,
        supplierName: item.supplier_name,
        supplierGci: item.supplier_gci,
        priceNet: item.price_amount,
        priceGross: item.price_with_tax_amount,
        quantity: item.quantity,
        sku: item.sku,
        deliveryDays: item.delivery_days,
        nextDeliveryDate: item.next_delivery_date,
      }))
      .sort((a, b) => a.priceNet - b.priceNet)

    return NextResponse.json({ ok: true, symbol, suppliers })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch supplier prices'
    return NextResponse.json({ ok: false, message }, { status: 500 })
  }
}
