export type TimerHandle = number;

export class ChronosError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);

    this.name = 'ChronosError';
    this.code = code;
  }
}
