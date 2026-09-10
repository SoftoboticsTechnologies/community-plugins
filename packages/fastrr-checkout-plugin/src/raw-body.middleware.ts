import { raw } from 'body-parser';
import * as http from 'http';

import { RequestWithRawBody } from './types';

/**
 * Adds the raw request body to the incoming message so the order-webhook route can verify
 * Fastrr's `X-Api-HMAC-SHA256` signature against the exact bytes Fastrr signed, rather than a
 * re-serialized (and therefore potentially non-identical) JSON.stringify of the parsed body.
 */
export const rawBodyMiddleware = raw({
    type: '*/*',
    verify(req: RequestWithRawBody, res: http.ServerResponse, buf: Buffer) {
        if (Buffer.isBuffer(buf)) {
            req.rawBody = Buffer.from(buf);
        }
        return true;
    },
});
