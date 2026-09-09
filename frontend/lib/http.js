/* http.js — reading an API reply without showing the reader a parser error.
 *
 * Every endpoint here answers with JSON, including its failures. A
 * platform failure does not: a function that crashes or times out is
 * served as the host's own HTML error page, and a proxy timeout as
 * plain text. Calling response.json() on either rejects with
 *
 *     Unexpected token 'A', "A server e"... is not valid JSON
 *
 * and that string reached a reader who had simply searched for PayPal.
 * It named a JSON parser, blamed the wrong thing, and told them nothing
 * they could act on.
 *
 * So: read the body as text, parse it if it is JSON, and otherwise say
 * what the status code means in a sentence the reader can act on. The
 * raw body is kept on the error as `.detail` for anyone debugging, and
 * `.status` and `.retryable` let a caller decide whether to offer a
 * retry rather than guessing.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RTHttp = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* What a status code means to someone reading a research page. */
  function describe(status, subject) {
    var what = subject ? subject : "this request";
    if (status === 429) {
      return "SEC EDGAR is rate-limiting requests right now. Wait a few " +
        "seconds and try again.";
    }
    if (status === 503) {
      return "That data feed is not configured on this deployment.";
    }
    if (status === 504 || status === 408) {
      return "SEC EDGAR did not answer in time. Try again — a second " +
        "attempt usually lands.";
    }
    if (status === 502) {
      return "The server could not complete " + what + ".";
    }
    if (status >= 500) {
      return "The server hit an error completing " + what +
        ". This is a fault on our side, not a problem with the company.";
    }
    if (status === 404) return "Nothing on file for " + what + ".";
    if (status >= 400) return "That request was rejected (HTTP " + status + ").";
    return "The server sent a reply this page could not read.";
  }

  function fail(message, status, detail, retryable) {
    var e = new Error(message);
    e.status = status;
    e.detail = typeof detail === "string" ? detail.slice(0, 500) : null;
    e.retryable = !!retryable;
    return e;
  }

  return {
    /**
     * Resolve a fetch Response to parsed JSON, or reject with an Error
     * whose message is fit to put on the page.
     *
     *   fetch(url).then(RTHttp.json).then(use).catch(showMessage)
     *
     * `subject` names what was being fetched, for the message ("PayPal
     * (PYPL)"). Optional.
     */
    json: function (response, subject) {
      return response.text().then(function (text) {
        var body = null, parsed = false;
        if (text) {
          try { body = JSON.parse(text); parsed = true; } catch (e) { parsed = false; }
        }
        var retryable = response.status === 429 || response.status === 408 ||
          response.status >= 500;
        if (response.ok) {
          if (parsed) return body;
          throw fail(describe(0, subject), response.status, text, false);
        }
        /* our own endpoints put a sentence in `error`; honour it */
        if (parsed && body && (body.error || body.detail)) {
          throw fail(String(body.error || body.detail), response.status, text, retryable);
        }
        throw fail(describe(response.status, subject), response.status, text, retryable);
      }, function (netErr) {
        throw fail(
          "The connection dropped before the reply arrived.",
          0, String((netErr && netErr.message) || netErr), true);
      });
    },

    /** The message to show for a rejection from json(), or from fetch itself. */
    message: function (err, subject) {
      if (err && err.message) return err.message;
      return describe(0, subject);
    },

    describe: describe,
  };
});
