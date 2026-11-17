/**
 * Is this datastore error **transient** ("try again soon": the database is down, restarting,
 * overloaded) or **permanent** ("this will never work": bad data, a bug)?
 *
 * Two places act on the answer:
 *   - the API answers 503 SERVICE_UNAVAILABLE instead of 500 (DESIGN.md §7.2);
 *   - the telemetry flusher (Phase 3, step 4) retries a batch instead of dead-lettering it.
 *
 * pg and ioredis report failures in three different ways, so all three are checked.
 */
export function isTransientDatastoreError(error: unknown): boolean {
  return findInErrorChain(error, isTransientOnItsOwn);
}

/** 1. Node.js network error codes: the connection could not be made or was cut. */
const TRANSIENT_NETWORK_CODES = new Set([
  'ECONNREFUSED', // nothing listening (container stopped)
  'ECONNRESET', // connection dropped mid-request
  'ETIMEDOUT',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND', // DNS: e.g. a compose service name while its container restarts
  'EAI_AGAIN', // DNS: temporary resolver failure
]);

/**
 * 2. Postgres SQLSTATE codes (https://www.postgresql.org/docs/current/errcodes-appendix.html).
 * Everything else, notably class 22 (bad data) and 23 (constraint violated), is permanent.
 */
function isTransientSqlState(code: string): boolean {
  return (
    code.startsWith('08') || // connection exception
    code.startsWith('53') || // insufficient resources (too many connections, disk full)
    code.startsWith('57P') || // server shutting down / restarting / not accepting yet
    code === '40001' || // serialization failure: retrying the transaction is the documented fix
    code === '40P01' // deadlock detected: same
  );
}

/**
 * 3. Errors with no code at all, recognised by message. Each line was observed from the real
 * libraries (pg 8, ioredis 6), not guessed.
 */
const TRANSIENT_MESSAGE_PREFIXES = [
  // pg
  'Connection terminated', // server closed the connection ("... unexpectedly", "... due to ...")
  'timeout exceeded when trying to connect', // pool: no connection within connectionTimeoutMillis
  'Client has encountered a connection error', // reusing a client whose connection died
  // ioredis
  'Connection is closed', // client gave up or was disconnected
  "Stream isn't writeable", // disconnected, and we disabled the offline queue on purpose
  'Reached the max retries per request limit',
  // Redis server replies start with an error code and a space ("BUSY " but not "BUSYGROUP").
  'LOADING ', // Redis is loading its data from disk after a restart
  'BUSY ', // a long-running script is blocking the server
  'OOM ', // maxmemory reached: queue writes fail instead of evicting data (DESIGN.md §6.3)
  'TRYAGAIN ',
  'MASTERDOWN ',
];

function isTransientOnItsOwn(error: Record<string, unknown>): boolean {
  const { code, message } = error;
  if (typeof code === 'string') {
    if (TRANSIENT_NETWORK_CODES.has(code)) {
      return true;
    }
    // SQLSTATE codes are exactly 5 characters; Node's codes start with "E".
    if (code.length === 5 && isTransientSqlState(code)) {
      return true;
    }
  }
  return (
    typeof message === 'string' &&
    TRANSIENT_MESSAGE_PREFIXES.some((prefix) => message.startsWith(prefix))
  );
}

/**
 * Errors are often wrapped: `new AppError(..., { cause })`, or an AggregateError when Node
 * tried several addresses. Checks the error, its `cause` chain and aggregated errors.
 */
function findInErrorChain(
  error: unknown,
  matches: (error: Record<string, unknown>) => boolean,
  depth = 0,
): boolean {
  const MAX_DEPTH = 5; // guards against a cyclic `cause`
  if (depth > MAX_DEPTH || typeof error !== 'object' || error === null) {
    return false;
  }

  const record = error as Record<string, unknown>;
  if (matches(record)) {
    return true;
  }
  if (error instanceof AggregateError) {
    return error.errors.some((inner) => findInErrorChain(inner, matches, depth + 1));
  }
  return findInErrorChain(record.cause, matches, depth + 1);
}
