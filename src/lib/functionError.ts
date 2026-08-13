export async function functionErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === 'object' && 'context' in error) {
    const context = (error as { context?: Response }).context
    if (context && typeof context.clone === 'function') {
      try {
        const body = await context.clone().json() as { message?: string }
        if (body?.message) return body.message
      } catch {
        // The response may not be JSON; fall through to the SDK message.
      }
    }
  }
  return error instanceof Error && error.message ? error.message : fallback
}
