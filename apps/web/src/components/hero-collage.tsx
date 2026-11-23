import Image from 'next/image';
import type { CSSProperties } from 'react';
import type { CollagePhoto } from '@/content/photos';

/** A collage place, as percentages of its box. The first is the big photo in the middle. */
interface Slot {
  left: number;
  top: number;
  width: number;
  aspect: string;
  tilt: number;
  z: string;
  /** Hidden on phones, where seven photos would crowd. */
  wideOnly?: boolean;
}

const SLOTS: readonly Slot[] = [
  { left: 25, top: 12, width: 50, aspect: 'aspect-[4/5]', tilt: -2, z: 'z-30' },
  { left: 0, top: 2, width: 30, aspect: 'aspect-[3/4]', tilt: -9, z: 'z-20' },
  { left: 70, top: 0, width: 30, aspect: 'aspect-[3/4]', tilt: 8, z: 'z-20' },
  { left: 0, top: 64, width: 42, aspect: 'aspect-[4/3]', tilt: 6, z: 'z-40' },
  { left: 56, top: 66, width: 44, aspect: 'aspect-[4/3]', tilt: -5, z: 'z-40' },
  { left: 2, top: 34, width: 22, aspect: 'aspect-[3/4]', tilt: 4, z: 'z-10', wideOnly: true },
  { left: 74, top: 37, width: 26, aspect: 'aspect-[4/3]', tilt: -7, z: 'z-10', wideOnly: true },
];

/** The collage's widest (px), for `sizes`: phones and laptops download small copies. */
const COLLAGE_PX = 544;

/** Photos pinned around the big one, tilted; hovering one straightens it and brings it forward. */
export function HeroCollage({ photos }: { photos: readonly CollagePhoto[] }) {
  return (
    <div className="relative mx-auto aspect-[1/1.05] w-full max-w-md sm:max-w-lg lg:max-w-none">
      {photos.slice(0, SLOTS.length).map((photo, index) => {
        const slot = SLOTS[index];
        if (slot === undefined) return null;
        return (
          <figure
            key={photo.src.src}
            className={`absolute rounded-[3px] bg-white p-1.5 pb-5 shadow-xl ring-1 ring-black/5 transition-transform duration-300 ease-out [transform:rotate(var(--tilt))] hover:z-50 hover:[transform:rotate(0deg)_scale(1.06)] sm:p-2 sm:pb-7 ${slot.z} ${slot.wideOnly === true ? 'hidden sm:block' : ''}`}
            style={
              {
                left: `${String(slot.left)}%`,
                top: `${String(slot.top)}%`,
                width: `${String(slot.width)}%`,
                '--tilt': `${String(slot.tilt)}deg`,
              } as CSSProperties
            }
          >
            <div className={`relative overflow-hidden bg-sunken ${slot.aspect}`}>
              <Image
                src={photo.src}
                alt={photo.alt}
                fill
                priority={index === 0}
                placeholder="blur"
                sizes={`(min-width: 640px) ${String(Math.ceil((COLLAGE_PX * slot.width) / 100))}px, ${String(slot.width)}vw`}
                className="object-cover"
                style={{ objectPosition: photo.focus ?? '50% 50%' }}
              />
            </div>
          </figure>
        );
      })}
    </div>
  );
}
