export interface B2BApiCursor {
  afterId: number | null
}

export function encodeCursor(cursor: B2BApiCursor): string {
  return JSON.stringify(cursor)
}

export function decodeCursor(raw: string): B2BApiCursor {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`Invalid cursor: not valid JSON`)
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid cursor: expected a plain object`)
  }

  const obj = parsed as Record<string, unknown>

  if (!('afterId' in obj)) {
    throw new Error(`Invalid cursor: missing field "afterId"`)
  }

  const { afterId } = obj

  if (afterId !== null && typeof afterId !== 'number') {
    throw new Error(`Invalid cursor: "afterId" must be a number or null`)
  }

  return { afterId } as B2BApiCursor
}
