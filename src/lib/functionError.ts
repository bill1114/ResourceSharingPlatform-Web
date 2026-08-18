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
      // No JSON message means the failure came from outside the function's own
      // error handling — a gateway 404 for a function that was never deployed,
      // a 401 before it ran, a 5xx from the runtime. supabase-js's generic
      // "non-2xx status code" text hides which of those it was, so keep the
      // status visible; it's the difference between "not deployed" and "the
      // function rejected the request".
      if (typeof context.status === 'number') {
        return `${fallback}（HTTP ${context.status}）`
      }
    }
  }
  return error instanceof Error && error.message ? error.message : fallback
}
