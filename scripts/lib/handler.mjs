/**
 * handler.mjs — the floor under every endpoint: it answers with JSON.
 *
 * A serverless function that throws is not served as an error object.
 * The platform serves its own page:
 *
 *     A server error has occurred
 *     FUNCTION_INVOCATION_FAILED
 *
 * The browser then calls response.json() on that HTML and the reader is
 * shown "Unexpected token 'A', "A server e"... is not valid JSON" —
 * which is what a reader searching for PayPal actually saw. The crash
 * was a one-line type assumption in one endpoint, but the reason it
 * reached them in that form was structural: nothing guaranteed the
 * contract that this API always speaks JSON.
 *
 * jsonSafe() guarantees it. Wrap the handler and an unexpected throw
 * becomes a 500 with an error field, like every deliberate failure. It
 * is a floor, not a substitute for handling errors where they happen: an
 * endpoint that knows why it failed should still say so precisely.
 */

/**
 * @param {(req, res) => Promise<any>} handler
 * @param {{ name?: string }} [opts]  name of the endpoint, for the message
 */
export function jsonSafe(handler, { name } = {}) {
  return async function jsonSafeHandler(req, res) {
    try {
      return await handler(req, res);
    } catch (e) {
      /* The handler may have answered before it threw. Overwriting that
         reply would replace real data with an error, so leave it. */
      if (res && res.headersSent) return undefined;
      const detail = String((e && e.message) || e).slice(0, 300);
      try {
        if (res.setHeader) res.setHeader("Cache-Control", "no-store");
        return res.status(500).json({
          error: name
            ? `The ${name} request did not complete.`
            : "That request did not complete.",
          detail,
        });
      } catch (inner) {
        /* the response is unusable; let the platform have it */
        throw e;
      }
    }
  };
}
