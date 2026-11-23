// App wording for the arena (ticker, lane header, popup): the vocabulary lives in the shared catalog next to the stage lists,
// so a new app only adds one entry there.
import { APP_VOCAB, displayId, vocabOf, type AppVocab } from '../../../haunt/src/shared/catalog';
import type { AppRef } from '../api/types';

export { APP_VOCAB, displayId, vocabOf };
export type { AppVocab };

/** The app id of a state snapshot or event: the string, or `app.id` of the v1.2 object. Orders when unknown. */
export function appIdOf(app: string | AppRef | undefined | null): string {
  const id = typeof app === 'string' ? app : app && typeof app === 'object' ? app.id : undefined;
  return id === 'inbox' ? 'inbox' : 'orders';
}
