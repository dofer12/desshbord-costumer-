import { classifyProfileFailure } from '../auth/errors'

/**
 * True when a request failed for a reason that may pass: no connection, a slow or overloaded
 * server (status 0, 408, 429 or 5xx). A change that failed like this stays in the queue and is sent
 * again. Any other refusal (a rule of the database, no permission, an expired login) will not pass
 * by waiting.
 */
export function isRetryable(err: unknown): boolean {
  return classifyProfileFailure(err) === 'unreachable'
}

/** True when the tables are missing or not granted, which means that the setup SQL was not run. */
export function isNotSetUp(err: unknown): boolean {
  return classifyProfileFailure(err) === 'notSetUp'
}
