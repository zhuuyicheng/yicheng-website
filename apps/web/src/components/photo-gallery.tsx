import Image from 'next/image';
import type { Photo } from '@/content/photos';

const TILE: Record<Photo['shape'], string> = {
  wide: 'col-span-2',
  tall: 'row-span-2',
  square: '',
};

/**
 * A grid of photos with captions: wide photos span two columns, tall ones two rows. Each photo
 * is cropped to its tile around `focus`; hovering zooms in slightly.
 */
export function PhotoGallery({ photos }: { photos: readonly Photo[] }) {
  return (
    <ul className="grid auto-rows-[11rem] grid-cols-2 gap-3 sm:auto-rows-[14rem] sm:gap-4 md:grid-cols-3 md:auto-rows-[16rem]">
      {photos.map((photo) => (
        <li key={photo.caption} className={TILE[photo.shape]}>
          <figure className="group relative h-full overflow-hidden rounded-2xl bg-sunken shadow-sm">
            <Image
              src={photo.src}
              alt={photo.alt}
              fill
              placeholder="blur"
              sizes={
                photo.shape === 'wide'
                  ? '(min-width: 768px) 44rem, 100vw'
                  : '(min-width: 768px) 22rem, 50vw'
              }
              className="object-cover transition duration-500 group-hover:scale-[1.03]"
              style={{ objectPosition: photo.focus ?? '50% 50%' }}
            />
            <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-4 pt-10 pb-3 text-sm font-medium text-white">
              {photo.caption}
            </figcaption>
          </figure>
        </li>
      ))}
    </ul>
  );
}
