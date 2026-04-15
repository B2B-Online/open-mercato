"use client"

import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'

interface SupplierEntry {
  pk: number
  supplierName: string
  supplierGci: string
  priceNet: number
  priceGross: number
  quantity: number
  sku: string
  deliveryDays: number | null
  nextDeliveryDate: string | null
}

interface SupplierPricesResponse {
  ok: boolean
  symbol?: string
  suppliers?: SupplierEntry[]
  message?: string
}

interface LineItem {
  id: string
  name: string | null
  sku: string | null
  quantity: number
  unitPriceNet: string | null
  currencyCode: string | null
}

interface OrderRecord {
  id: string
  currencyCode?: string | null
}

interface WidgetContext {
  kind?: string
  record?: OrderRecord | null
}

function extractSkuFromLine(line: Record<string, unknown>): string | null {
  // Direct sku field
  if (typeof line.sku === 'string' && line.sku.trim()) return line.sku.trim()
  // metadata.productSku or metadata.variantSku (stored by LineItemDialog)
  const meta = line.metadata as Record<string, unknown> | null | undefined
  if (meta) {
    if (typeof meta.variantSku === 'string' && meta.variantSku.trim()) return meta.variantSku.trim()
    if (typeof meta.productSku === 'string' && meta.productSku.trim()) return meta.productSku.trim()
  }
  // catalogSnapshot.product.sku or catalogSnapshot.variant.sku
  const snap = line.catalog_snapshot as Record<string, unknown> | null | undefined
    ?? line.catalogSnapshot as Record<string, unknown> | null | undefined
  if (snap) {
    const variant = snap.variant as Record<string, unknown> | null | undefined
    if (variant && typeof variant.sku === 'string' && variant.sku.trim()) return variant.sku.trim()
    const product = snap.product as Record<string, unknown> | null | undefined
    if (product && typeof product.sku === 'string' && product.sku.trim()) return product.sku.trim()
  }
  return null
}

function formatPrice(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}

function SupplierPricesPanel({ line, currency, onApply }: {
  line: LineItem
  currency: string
  onApply: (lineId: string, priceNet: string, supplierName: string) => Promise<void>
}) {
  const [suppliers, setSuppliers] = React.useState<SupplierEntry[] | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [applying, setApplying] = React.useState<number | null>(null)
  const [expanded, setExpanded] = React.useState(false)

  const loadSuppliers = React.useCallback(async () => {
    if (!line.sku) return
    setLoading(true)
    setError(null)
    try {
      const result = await apiCall<SupplierPricesResponse>(
        `/api/sync_b2bapi/supplier-prices?symbol=${encodeURIComponent(line.sku)}`,
      )
      if (result.result?.ok && result.result.suppliers) {
        setSuppliers(result.result.suppliers)
      } else {
        setError(result.result?.message ?? 'Failed to load supplier prices')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load supplier prices')
    } finally {
      setLoading(false)
    }
  }, [line.sku])

  const handleExpand = React.useCallback(() => {
    if (!expanded && suppliers === null) {
      void loadSuppliers()
    }
    setExpanded((prev) => !prev)
  }, [expanded, suppliers, loadSuppliers])

  const handleApply = React.useCallback(async (supplier: SupplierEntry) => {
    setApplying(supplier.pk)
    try {
      await onApply(line.id, supplier.priceNet.toFixed(4), supplier.supplierName)
      flash(`Price updated: ${supplier.supplierName} — ${formatPrice(supplier.priceNet, currency)}`, 'success')
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Failed to update price', 'error')
    } finally {
      setApplying(null)
    }
  }, [line.id, currency, onApply])

  if (!line.sku) return null

  return (
    <div className="rounded-md border bg-card">
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted/50 transition-colors"
        onClick={handleExpand}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-medium truncate">{line.name ?? line.sku}</span>
          <span className="text-xs text-muted-foreground shrink-0">SKU: {line.sku}</span>
          {line.unitPriceNet && (
            <Badge variant="outline" className="text-xs shrink-0">
              {formatPrice(parseFloat(line.unitPriceNet), currency)}
            </Badge>
          )}
        </div>
        <span className="text-xs text-muted-foreground shrink-0 ml-2">
          {expanded ? '▲ Hide' : '▼ Suppliers'}
        </span>
      </button>

      {expanded && (
        <div className="border-t px-3 py-2">
          {loading && (
            <p className="text-xs text-muted-foreground py-2">Loading supplier prices…</p>
          )}
          {error && (
            <p className="text-xs text-destructive py-2">{error}</p>
          )}
          {suppliers !== null && suppliers.length === 0 && (
            <p className="text-xs text-muted-foreground py-2">No active suppliers found for this product.</p>
          )}
          {suppliers !== null && suppliers.length > 0 && (
            <div className="space-y-1">
              {suppliers.map((supplier) => (
                <div
                  key={supplier.pk}
                  className="flex items-center justify-between gap-2 rounded px-2 py-1.5 hover:bg-muted/50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{supplier.supplierName}</span>
                      {supplier.quantity > 0 && (
                        <Badge variant="secondary" className="text-xs shrink-0">
                          Qty: {supplier.quantity}
                        </Badge>
                      )}
                      {supplier.quantity === 0 && (
                        <Badge variant="outline" className="text-xs shrink-0 text-muted-foreground">
                          Out of stock
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-sm font-semibold text-foreground">
                        {formatPrice(supplier.priceNet, currency)}
                      </span>
                      {supplier.deliveryDays !== null && (
                        <span className="text-xs text-muted-foreground">
                          {supplier.deliveryDays}d delivery
                        </span>
                      )}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 h-7 text-xs"
                    disabled={applying === supplier.pk}
                    onClick={() => void handleApply(supplier)}
                  >
                    {applying === supplier.pk ? 'Applying…' : 'Use price'}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function SupplierPricesWidget({ context }: InjectionWidgetComponentProps<WidgetContext>) {
  const record = context?.record
  const orderId = record?.id ?? null
  const currency = record?.currencyCode ?? 'USD'

  const [lineItems, setLineItems] = React.useState<LineItem[] | null>(null)
  const [linesLoading, setLinesLoading] = React.useState(false)
  const [linesError, setLinesError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!orderId) return
    setLinesLoading(true)
    setLinesError(null)
    apiCall<{ items?: Array<Record<string, unknown>> }>(
      `/api/sales/order-lines?orderId=${encodeURIComponent(orderId)}&pageSize=100`,
    )
      .then((res) => {
        if (res.ok && Array.isArray(res.result?.items)) {
          const mapped: LineItem[] = res.result.items
            .map((line) => ({
              id: typeof line.id === 'string' ? line.id : String(line.id ?? ''),
              name: typeof line.name === 'string' ? line.name : null,
              sku: extractSkuFromLine(line),
              quantity: Number(line.quantity ?? 1),
              unitPriceNet: typeof line.unit_price_net === 'string' ? line.unit_price_net
                : typeof line.unitPriceNet === 'string' ? line.unitPriceNet : null,
              currencyCode: typeof line.currency_code === 'string' ? line.currency_code
                : typeof line.currencyCode === 'string' ? line.currencyCode : null,
            }))
            .filter((line) => Boolean(line.sku))
          setLineItems(mapped)
        } else {
          setLinesError('Failed to load order lines')
        }
      })
      .catch((err) => {
        setLinesError(err instanceof Error ? err.message : 'Failed to load order lines')
      })
      .finally(() => setLinesLoading(false))
  }, [orderId])

  const handleApplyPrice = React.useCallback(async (lineId: string, priceNet: string, supplierName: string) => {
    await updateCrud(`sales/order-lines/${lineId}`, {
      unitPriceNet: priceNet,
      unitPriceGross: priceNet,
      priceMode: 'net',
      metadata: { supplierName },
    })
  }, [])

  if (!record) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        No order data available.
      </div>
    )
  }

  if (linesLoading) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Loading order lines…
      </div>
    )
  }

  if (linesError) {
    return (
      <div className="p-4 text-sm text-destructive">
        {linesError}
      </div>
    )
  }

  if (!lineItems || lineItems.length === 0) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        No product lines with SKU found in this order. Add products from the b2bapi catalog first.
      </div>
    )
  }

  return (
    <div className="space-y-2 p-4">
      <div className="mb-3">
        <h3 className="text-sm font-medium">Supplier Prices</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Click on a product line to see available supplier prices. Click "Use price" to apply it to the order line.
        </p>
      </div>
      {lineItems.map((line) => (
        <SupplierPricesPanel
          key={line.id}
          line={line}
          currency={currency}
          onApply={handleApplyPrice}
        />
      ))}
    </div>
  )
}
