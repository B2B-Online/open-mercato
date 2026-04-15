"use client"

import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'

type ImportResult = {
  ok: boolean
  message?: string
  productId?: number
  symbol?: string
  name?: string
  items?: Array<{ externalId: string; action: string }>
}

export default function B2BApiConfigWidget(_props: InjectionWidgetComponentProps) {
  const [productId, setProductId] = React.useState('')
  const [isImporting, setIsImporting] = React.useState(false)
  const [lastResult, setLastResult] = React.useState<ImportResult | null>(null)

  const handleImport = React.useCallback(async () => {
    const id = parseInt(productId.trim(), 10)
    if (!Number.isInteger(id) || id <= 0) {
      flash('Enter a valid positive integer product ID.', 'error')
      return
    }

    setIsImporting(true)
    setLastResult(null)
    try {
      const result = await apiCall<ImportResult>('/api/sync_b2bapi/import-product', {
        method: 'POST',
        body: JSON.stringify({ productId: id }),
      })

      const data = result.result ?? { ok: false, message: 'Unknown error' }
      setLastResult(data)

      if (data.ok) {
        const actions = data.items?.map((i) => i.action).join(', ') ?? ''
        flash(`Imported: ${data.name ?? ''} (${data.symbol ?? ''}) — ${actions}`, 'success')
      } else {
        flash(data.message ?? 'Import failed', 'error')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Import failed'
      flash(message, 'error')
      setLastResult({ ok: false, message })
    } finally {
      setIsImporting(false)
    }
  }, [productId])

  const handleKeyDown = React.useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleImport()
  }, [handleImport])

  return (
    <div className="space-y-4 rounded-lg border bg-card p-4">
      <div>
        <h3 className="text-sm font-medium">Import single product</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Enter an ishark product ID to import or re-sync a single product for testing.
        </p>
      </div>

      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1">
          <Label htmlFor="b2bapi-product-id" className="text-xs">Product ID</Label>
          <Input
            id="b2bapi-product-id"
            type="number"
            min={1}
            placeholder="e.g. 12345"
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isImporting}
            className="h-8 text-sm"
          />
        </div>
        <Button
          size="sm"
          onClick={handleImport}
          disabled={isImporting || !productId.trim()}
        >
          {isImporting ? 'Importing…' : 'Import'}
        </Button>
      </div>

      {lastResult && (
        <div className={`rounded-md p-3 text-xs ${lastResult.ok ? 'bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200' : 'bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200'}`}>
          {lastResult.ok ? (
            <div className="space-y-1">
              <div><span className="font-medium">Symbol:</span> {lastResult.symbol}</div>
              <div><span className="font-medium">Name:</span> {lastResult.name}</div>
              {lastResult.items?.map((item) => (
                <div key={item.externalId}>
                  <span className="font-medium uppercase">{item.action}</span> {item.externalId}
                </div>
              ))}
            </div>
          ) : (
            <span>{lastResult.message}</span>
          )}
        </div>
      )}
    </div>
  )
}
