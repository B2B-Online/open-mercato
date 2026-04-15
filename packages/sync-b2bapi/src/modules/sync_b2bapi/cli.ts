import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createCredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import { validateCredentials } from './lib/credentials'
import { createB2BApiDbClient } from './lib/db-client'
import { createB2BApiCatalogImporter } from './lib/catalog-importer'

const INTEGRATION_ID = 'sync_b2bapi'

function parseArgs(args: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (!arg.startsWith('--')) continue
    const key = arg.slice(2)
    if (key.includes('=')) {
      const [name, value] = key.split('=')
      result[name] = value
      continue
    }
    const next = args[i + 1]
    if (next && !next.startsWith('--')) {
      result[key] = next
      i += 1
      continue
    }
    result[key] = true
  }
  return result
}

function printHelp(): void {
  console.log('Usage: yarn mercato sync_b2bapi import-product --tenant <tenantId> --org <organizationId> --id <productId>')
  console.log('')
  console.log('Options:')
  console.log('  --tenant, --tenantId   Tenant ID')
  console.log('  --org, --orgId         Organization ID')
  console.log('  --id                   ishark product ID (integer) to import')
  console.log('')
  console.log('Reads credentials from the integration settings stored in the database.')
  console.log('Configure them first via Integrations → B2BAPI Product Sync in the UI.')
}

const importProductCommand: ModuleCli = {
  command: 'import-product',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.orgId ?? args.org ?? '')
    const productIdRaw = args.id ? parseInt(String(args.id), 10) : NaN

    if (!tenantId || !organizationId || isNaN(productIdRaw)) {
      printHelp()
      process.exitCode = 1
      return
    }

    const container = await createRequestContainer()
    try {
      const em = container.resolve('em') as EntityManager
      const credentialsService = createCredentialsService(em)
      const raw = await credentialsService.getRaw(INTEGRATION_ID, { tenantId, organizationId })

      if (!raw) {
        console.error(`[sync_b2bapi] No credentials found for tenant=${tenantId} org=${organizationId}.`)
        console.error('Configure them via Integrations → B2BAPI Product Sync in the UI.')
        process.exitCode = 1
        return
      }

      const credentials = validateCredentials(raw)
      const client = createB2BApiDbClient(credentials)

      try {
        console.log(`[sync_b2bapi] Fetching product id=${productIdRaw} from ishark...`)
        const row = await client.queryProductById({
          frontendId: credentials.frontendId,
          productId: productIdRaw,
        })

        if (!row) {
          console.error(`[sync_b2bapi] Product id=${productIdRaw} not found for frontendId=${credentials.frontendId}.`)
          process.exitCode = 1
          return
        }

        console.log(`[sync_b2bapi] Found: symbol=${row.symbol} name="${row.name}"`)
        console.log('[sync_b2bapi] Importing into catalog...')

        const importer = await createB2BApiCatalogImporter({ organizationId, tenantId })
        const items = await importer.upsertProduct(row, {})

        for (const item of items) {
          console.log(`[sync_b2bapi] ${item.action.toUpperCase()} externalId=${item.externalId}`)
        }

        console.log('[sync_b2bapi] Done.')
      } finally {
        await client.close()
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[sync_b2bapi] Error: ${message}`)
      process.exitCode = 1
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

const helpCommand: ModuleCli = {
  command: 'help',
  async run() {
    printHelp()
  },
}

export default [importProductCommand, helpCommand]
