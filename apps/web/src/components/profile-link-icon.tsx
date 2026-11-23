import { ArrowUpRight } from 'lucide-react';
import { LinkedInIcon } from './icons/linkedin-icon';

/** LinkedIn's mark for LinkedIn, an arrow for anything else. */
export function ProfileLinkIcon({
  url,
  className,
}: {
  url: string;
  className?: string | undefined;
}) {
  return isLinkedIn(url) ? (
    <LinkedInIcon className={className} />
  ) : (
    <ArrowUpRight aria-hidden className={className} />
  );
}

function isLinkedIn(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === 'linkedin.com' || host.endsWith('.linkedin.com');
  } catch {
    return false; // not a URL: no brand to show
  }
}
