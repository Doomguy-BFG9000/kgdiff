import type { KgdiffErrorCode } from './types.js';

/** Error type thrown by every kgdiff package. */
export class KgdiffError extends Error {
  override readonly name = 'KgdiffError';
  constructor(
    readonly code: KgdiffErrorCode,
    message: string,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
  }
}
