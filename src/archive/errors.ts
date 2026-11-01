export type ArchiveErrorCode =
  | 'not-zip'
  | 'truncated'
  | 'encrypted'
  | 'too-many-entries'
  | 'entry-too-large'
  | 'ratio'
  | 'unsupported-method'
  | 'bad-entry'
  | 'no-images'
  | 'unsupported-format'
  | 'too-large'
  | 'text-epub';

/** Typed archive failure; `message` is safe to show to the user (never contains markup). */
export class ArchiveError extends Error {
  readonly code: ArchiveErrorCode;
  constructor(code: ArchiveErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'ArchiveError';
    this.code = code;
  }
}
