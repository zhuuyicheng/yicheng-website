'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import Image from 'next/image';
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { Photo } from '@/content/photos';
import { circularOffset, ringPlacement, wrapIndex } from '@/lib/carousel';

/** A horizontal drag this long (px) is a swipe. */
const SWIPE_PX = 40;

/**
 * The "Outside work" photos on a turning ring (lib/carousel.ts). Turn it with the arrows, dots,
 * a side photo, ← → or a swipe. Reduced motion skips the animation.
 */
export function PhotoCarousel({ photos }: { photos: readonly Photo[] }) {
  const [active, setActive] = useState(0);
  const swipeStart = useRef<number | null>(null);
  const count = photos.length;
  const current = photos[active];
  if (current === undefined) {
    return null;
  }

  const go = (index: number) => {
    setActive(wrapIndex(index, count));
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      go(active + (event.key === 'ArrowLeft' ? -1 : 1));
    }
  };
  const onPointerDown = (event: PointerEvent) => {
    swipeStart.current = event.clientX;
  };
  const onPointerUp = (event: PointerEvent) => {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (start === null) return;
    const distance = event.clientX - start;
    if (Math.abs(distance) >= SWIPE_PX) {
      go(active + (distance < 0 ? 1 : -1)); // swipe left = next, like a page
    }
  };

  return (
    <div
      role="region"
      aria-roledescription="carousel"
      aria-label="Photos from outside work"
      onKeyDown={onKeyDown}
    >
      <div className="relative mx-auto max-w-3xl">
        {/* Clips the side photos on narrow screens instead of scrolling the page sideways. */}
        <div className="overflow-hidden py-8">
          <div
            className="relative mx-auto aspect-[4/5] w-[min(66vw,19rem)] touch-pan-y [perspective:1400px]"
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerCancel={() => {
              swipeStart.current = null;
            }}
          >
            {photos.map((photo, index) => {
              const offset = circularOffset(index, active, count);
              const place = ringPlacement(offset, count);
              const image = (
                <Image
                  src={photo.src}
                  alt={photo.alt}
                  fill
                  draggable={false}
                  placeholder="blur"
                  sizes="(min-width: 640px) 19rem, 66vw"
                  className="object-cover select-none"
                  style={{ objectPosition: photo.focus ?? '50% 50%' }}
                />
              );
              return (
                <div
                  key={photo.src.src}
                  aria-hidden={place.hidden}
                  inert={place.hidden}
                  className="absolute inset-0 overflow-hidden rounded-3xl bg-sunken shadow-xl transition-[transform,opacity] duration-700 ease-[cubic-bezier(0.2,0.7,0.2,1)]"
                  style={{
                    transform: `translateX(${String(place.x)}%) translateZ(${String(place.z)}px) rotateY(${String(place.rotateY)}deg) scale(${String(place.scale)})`,
                    opacity: place.opacity,
                    zIndex: place.zIndex,
                  }}
                >
                  {offset === 0 ? (
                    image
                  ) : (
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label={`Show: ${photo.caption}`}
                      className="absolute inset-0 cursor-pointer"
                      onClick={() => {
                        go(index);
                      }}
                    >
                      {image}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <TurnButton
          direction="previous"
          onClick={() => {
            go(active - 1);
          }}
        />
        <TurnButton
          direction="next"
          onClick={() => {
            go(active + 1);
          }}
        />
      </div>

      <div className="mt-2 flex flex-col items-center text-center">
        <p className="font-display text-2xl font-semibold text-ink">{current.caption}</p>
        {current.description !== undefined && (
          <p className="mt-2 max-w-md leading-relaxed text-muted">{current.description}</p>
        )}
        <div className="mt-4 flex items-center gap-1" role="group" aria-label="Choose a photo">
          {photos.map((photo, index) => (
            <button
              key={photo.src.src}
              type="button"
              aria-label={`Photo ${String(index + 1)}: ${photo.caption}`}
              aria-current={index === active ? 'true' : undefined}
              className="p-1.5"
              onClick={() => {
                go(index);
              }}
            >
              <span
                aria-hidden
                className={`block h-2 rounded-full transition-all ${
                  index === active ? 'w-6 bg-brand' : 'w-2 bg-line-strong hover:bg-faint'
                }`}
              />
            </button>
          ))}
        </div>
        <p className="sr-only" aria-live="polite">
          {`Photo ${String(active + 1)} of ${String(count)}: ${current.caption}`}
        </p>
      </div>
    </div>
  );
}

function TurnButton({
  direction,
  onClick,
}: {
  direction: 'previous' | 'next';
  onClick: () => void;
}) {
  const Icon = direction === 'previous' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      aria-label={direction === 'previous' ? 'Previous photo' : 'Next photo'}
      onClick={onClick}
      className={`absolute top-1/2 z-40 flex size-11 -translate-y-1/2 items-center justify-center rounded-full border border-line-strong bg-surface/90 text-ink shadow-md backdrop-blur transition hover:border-brand hover:text-brand ${
        direction === 'previous' ? 'left-1 sm:left-0' : 'right-1 sm:right-0'
      }`}
    >
      <Icon aria-hidden className="size-5" />
    </button>
  );
}
