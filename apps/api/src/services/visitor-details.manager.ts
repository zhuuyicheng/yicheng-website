import Bowser from 'bowser';
import type { IpLocationDal } from '../dal/ip-location.dal.js';
import type {
  Campaign,
  Device,
  EventRequest,
  VisitorDetails,
} from '../schema/analytics-event.schema.js';

/**
 * What the request reveals about the visitor. The user agent is never stored or logged; the
 * IP is stored with the event by the owner's choice (DESIGN.md §12), never logged.
 */
export interface Visitor {
  ip: string;
  userAgent: string;
  acceptLanguage: string;
}

/**
 * Visitor details (DESIGN.md §8.2) from the link (campaign), browser (device) and IP
 * (network). In-memory only, so nothing here can be slow or fail.
 */
export interface VisitorDetailsManager {
  describe: (event: EventRequest, visitor: Visitor) => VisitorDetails;
}

export function createVisitorDetailsManager(deps: {
  ipLocationDal: IpLocationDal;
}): VisitorDetailsManager {
  return {
    describe(event, visitor) {
      return {
        campaign: campaignFrom(event.path),
        device: deviceFrom(visitor, event.timezone ?? null),
        network: deps.ipLocationDal.lookup(visitor.ip),
      };
    },
  };
}

/** Tagged-link parameters: share `/?ref=acme` with one company and its visits say `acme`. */
export function campaignFrom(path: string): Campaign {
  // The query string is between "?" and "#" ("/a#x?ref=b" has none).
  const [withoutFragment = ''] = path.split('#', 1);
  const queryStart = withoutFragment.indexOf('?');
  const query = new URLSearchParams(queryStart === -1 ? '' : withoutFragment.slice(queryStart + 1));

  return {
    ref: nonEmpty(query.get('ref')),
    utmSource: nonEmpty(query.get('utm_source')),
    utmMedium: nonEmpty(query.get('utm_medium')),
    utmCampaign: nonEmpty(query.get('utm_campaign')),
  };
}

/** Real ones are under 300 characters; the cap bounds the parser's work on junk. */
const MAX_USER_AGENT_LENGTH = 512;

/** `Mozilla/5.0 (Macintosh; ...) Chrome/131...` → Chrome, macOS, desktop. */
export function deviceFrom(
  visitor: Pick<Visitor, 'userAgent' | 'acceptLanguage'>,
  timezone: string | null,
): Device {
  const userAgent = visitor.userAgent.trim().slice(0, MAX_USER_AGENT_LENGTH);
  // bowser throws on an empty user agent (curl, some bots).
  const parsed = userAgent === '' ? null : Bowser.parse(userAgent);

  return {
    browser: nonEmpty(parsed?.browser.name),
    os: nonEmpty(parsed?.os.name),
    type: nonEmpty(parsed?.platform.type),
    language: primaryLanguage(visitor.acceptLanguage),
    timezone,
  };
}

/** "en", "en-SG", "zh-Hant-TW". */
const LANGUAGE_TAG = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8}){0,3}$/;

/** `en-SG,en;q=0.9` → `en-SG`, the preferred one. */
export function primaryLanguage(acceptLanguage: string): string | null {
  const [first = ''] = acceptLanguage.split(',', 1);
  const [tag = ''] = first.split(';', 1);
  const trimmed = tag.trim();
  return LANGUAGE_TAG.test(trimmed) ? trimmed : null;
}

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? null : trimmed;
}
