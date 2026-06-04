export function reportClientError(error: unknown, context: Record<string, unknown> = {}) {
  console.error("client error", { error, ...context });
}
