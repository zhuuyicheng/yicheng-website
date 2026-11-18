import { createHmac } from 'node:crypto';

/** Turns an IP address into a stable, irreversible identifier (64 hex characters). */
export type IpHasher = (ip: string) => string;

/**
 * HMAC-SHA256 of the IP, keyed with IP_HASH_SECRET (DESIGN.md §6.4, §12). Used wherever the
 * contact module needs to recognise a sender: the rate-limit key and `contact_messages.ip_hash`.
 *
 * Why a keyed hash and not plain sha256(ip): there are only ~4 billion IPv4 addresses, so a
 * plain hash can be reversed by hashing every one of them (minutes on a laptop). Without the
 * secret, that is impossible.
 *
 * Why not the daily telemetry salt: the same sender must keep the same hash across midnight,
 * otherwise a rate-limit window would reset at 00:00 UTC.
 */
export function createIpHasher(secret: string): IpHasher {
  return (ip) => createHmac('sha256', secret).update(ip).digest('hex');
}
