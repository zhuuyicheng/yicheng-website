import type { StaticImageData } from 'next/image';
import alps from './photos/alps.jpg';
import arch from './photos/arch.jpg';
import farmTomita from './photos/farm-tomita.jpg';
import judo from './photos/judo.jpg';

/**
 * The "Outside work" photos on the home page, in display order. Edit captions and descriptions
 * here; add a photo by putting a JPEG in ./photos (resized, location data removed: see
 * docs/EDITING-THE-SITE.md) and adding an entry.
 *
 * `alt` describes the picture for people who cannot see it; `caption` is shown on it.
 * `shape` picks its tile: `wide` (two columns), `tall` (two rows) or `square`.
 * `focus` is the CSS object-position that keeps the subject in view when the tile crops it.
 */
export interface Photo {
  src: StaticImageData;
  alt: string;
  caption: string;
  shape: 'wide' | 'tall' | 'square';
  focus?: string;
}

export const PHOTOS: readonly Photo[] = [
  {
    src: alps,
    alt: 'Four friends seen from behind, looking out over a green valley and snowy mountains',
    caption: 'With friends in the Alps',
    shape: 'wide',
    focus: '50% 45%',
  },
  {
    src: judo,
    alt: 'Yicheng and a friend in judo uniforms with orange belts, each wearing a medal',
    caption: 'Judo, on a medal day',
    shape: 'tall',
    focus: '50% 30%',
  },
  {
    src: farmTomita,
    alt: 'Yicheng standing by the Farm Tomita sign in front of rows of red, orange and yellow flowers',
    caption: 'Farm Tomita, Hokkaido',
    shape: 'square',
    focus: '60% 65%',
  },
  {
    src: arch,
    alt: 'Yicheng laughing while hanging from a round stone arch in a garden',
    caption: 'Hanging around',
    shape: 'square',
    focus: '50% 40%',
  },
];
