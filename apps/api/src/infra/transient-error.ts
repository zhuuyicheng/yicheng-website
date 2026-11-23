/**
 * Transient ("try again soon": down, restarting, overloaded) or permanent (bad data, a bug)?
 * Transient means a 503 instead of a 500 (DESIGN.md §7.2), and a retried batch instead of a
 * dead-lettered one. pg and ioredis report failures three ways, so all three are checked.
 */
export function isTransientDatastoreError(error: unknown): boolean {
  return findInErrorChain(error, isTransientOnItsOwn);
}

/** 1. Node network codes: the connection failed or was cut. */
const TRANSIENT_NETWORK_CODES = new Set([
  'ECONNREFUSED', // nothing listening (container stopped)
  'ECONNRESET', // connection dropped mid-request
  'ETIMEDOUT',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND', // DNS: e.g. a compose service while its container restarts
  'EAI_AGAIN', // DNS: temporary resolver failure
]);

/** 2. Postgres SQLSTATE. Everything else, notably classes 22 (bad data) and 23, is permanent. */
function isTransientSqlState(code: string): boolean {
  return (
    code.startsWith('08') || // connection exception
    code.startsWith('53') || // insufficient resources (too many connections, disk full)
    code.startsWith('57P') || // shutting down, restarting or not ready yet
    code === '40001' || // serialization failure: retrying is the documented fix
    code === '40P01' // deadlock detected: same
  );
}

/** 3. Errors without a code, by message. Each seen from the real libraries, not guessed. */
const TRANSIENT_MESSAGE_PREFIXES = [
  // pg
  'Connection terminated', // the server closed the connection
  'timeout exceeded when trying to connect', // pool: no connection within connectionTimeoutMillis
  'Client has encountered a connection error', // reusing a client whose connection died
  // ioredis
  'Connection is closed', // client gave up or was disconnected
  "Stream isn't writeable", // disconnected, with the offline queue off on purpose
  'Reached the max retries per request limit',
  // Redis replies start with a code and a space ("BUSY ", not "BUSYGROUP").
  'LOADING ', // loading its data from disk after a restart
  'BUSY ', // a long script is blocking the server
  'OOM ', // maxmemory reached: writes fail rather than evict data (DESIGN.md §6.3)
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

/** Checks the error, its `cause` chain and AggregateError members (errors are often wrapped). */
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
