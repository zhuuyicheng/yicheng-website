import { createHmac } from 'node:crypto';

/** A stable, irreversible id for an IP address (64 hex characters). */
export type IpHasher = (ip: string) => string;

/**
 * HMAC-SHA256 of the IP with IP_HASH_SECRET (DESIGN.md §6.4). Keyed, because a plain hash of
 * one of ~4 billion IPv4 addresses can be reversed by brute force. Not the daily telemetry
 * salt: a sender's hash must survive midnight, or rate-limit windows would reset.
 */
export function createIpHasher(secret: string): IpHasher {
  return (ip) => createHmac('sha256', secret).update(ip).digest('hex');
}
