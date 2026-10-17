/** An error of the database API that carries the HTTP status of the answer (0 when the server was not reached). */
export type ApiError = Error & { code?: string; status: number }

/**
 * What the code of the app needs to know about a failed request: the message, the code that the database
 * gave and the status. The status tells "the server is in trouble" from "not allowed" from "not found".
 */
export function apiError(error: { message: string; code?: string }, status: number): ApiError {
  return Object.assign(new Error(error.message), { code: error.code, status })
}
