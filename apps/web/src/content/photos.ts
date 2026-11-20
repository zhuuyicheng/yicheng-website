import type { StaticImageData } from 'next/image';
import alpsPeace from './photos/alps-peace.jpg';
import alps from './photos/alps.jpg';
import arch from './photos/arch.jpg';
import dinner from './photos/dinner.jpg';
import farmTomita from './photos/farm-tomita.jpg';
import graduation from './photos/graduation.jpg';
import hitachiTeam from './photos/hitachi-team.jpg';
import judo from './photos/judo.jpg';
import planeNap from './photos/plane-nap.jpg';
import portrait from './photos/portrait.jpg';
import yellowShirt from './photos/yellow-shirt.jpg';
import yoteiArmsCrossed from './photos/yotei-arms-crossed.jpg';

/**
 * The "Outside work" photos on the home page, in the order the carousel shows them. Edit
 * captions here; add a photo by putting a JPEG in ./photos (resized, location data removed:
 * see docs/EDITING-THE-SITE.md §3) and adding an entry.
 *
 *   - `alt`: what the picture shows, for people who cannot see it (read by screen readers).
 *   - `caption`: the title under the photo, e.g. the activity or place.
 *   - `description` (optional): a sentence or two under the caption.
 *   - `focus` (optional): which part stays in view when the photo is cropped to the portrait
 *     card, as "x% y%" (from the left, from the top). Default: the centre.
 */
export interface Photo {
  src: StaticImageData;
  alt: string;
  caption: string;
  description?: string;
  focus?: string;
}

export const PHOTOS: readonly Photo[] = [
  {
    src: graduation,
    alt: 'Yicheng and two friends in graduation gowns and caps at the NUS Commencement, Class of 2026',
    caption: 'NUS Commencement, Class of 2026',
    focus: '50% 45%',
  },
  {
    src: alps,
    alt: 'Four friends seen from behind, looking out over a green valley and snowy mountains',
    caption: 'With friends in the Alps',
    focus: '55% 50%',
  },
  {
    src: judo,
    alt: 'Yicheng and a friend in judo uniforms with orange belts, each wearing a medal',
    caption: 'Keeping fit with Judo',
    focus: '50% 40%',
  },
  {
    src: farmTomita,
    alt: 'Yicheng standing by the Farm Tomita sign in front of rows of red, orange and yellow flowers',
    caption: 'In the flower fields of Farm Tomita, Hokkaido',
    focus: '50% 75%',
  },
  {
    src: arch,
    alt: 'Yicheng laughing while hanging from a round stone arch in a garden',
    caption: 'Hanging around!',
    focus: '50% 45%',
  },
];

/**
 * The photo collage beside the name at the top of the home page (components/hero-collage.tsx).
 * The first is the large one in the middle; the others are pinned around it, tilted. The
 * collage has seven places, so only the first seven are shown, and on phones only the first
 * five. `alt` and `focus` mean the same as above.
 */
export interface CollagePhoto {
  src: StaticImageData;
  alt: string;
  focus?: string;
}

export const HERO_PHOTOS: readonly CollagePhoto[] = [
  { src: portrait, alt: 'Yicheng smiling in a field of pink flowers, a mountain behind him' },
  { src: dinner, alt: 'Yicheng smiling at a restaurant table', focus: '50% 35%' },
  { src: alpsPeace, alt: 'Yicheng making a peace sign on a mountain trail', focus: '50% 55%' },
  {
    src: yoteiArmsCrossed,
    alt: 'Yicheng with arms crossed in front of a flower field and a mountain',
    focus: '50% 45%',
  },
  {
    src: hitachiTeam,
    alt: 'A group photo with colleagues in front of a Hitachi sign',
    focus: '50% 50%',
  },
  {
    src: planeNap,
    alt: 'Yicheng napping on a plane in an eye mask, face mask and headphones',
    focus: '50% 45%',
  },
  { src: yellowShirt, alt: 'Yicheng in a yellow T-shirt, mid-laugh', focus: '40% 45%' },
];
