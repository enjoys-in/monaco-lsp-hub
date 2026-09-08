import * as monaco from 'monaco-editor';
import { raceCancellation } from '../utils';

/**
 * Issue an LSP request on behalf of a Monaco provider, honouring the editor's
 * cancellation token.
 *
 * Returns `undefined` when the request was cancelled — before it was sent, or
 * while it was in flight — so a provider can bail out without converting or
 * applying a result the editor has already discarded. Providers previously
 * ignored the token entirely, which meant every keystroke's worth of requests
 * ran to completion and stale answers could still be rendered.
 */
export async function lspRequest<T>(
    token: monaco.CancellationToken,
    run: () => Promise<T>,
): Promise<T | undefined> {
    if (token.isCancellationRequested) {
        return undefined;
    }
    const result = await raceCancellation(run(), token);
    if (token.isCancellationRequested) {
        return undefined;
    }
    return result;
}
