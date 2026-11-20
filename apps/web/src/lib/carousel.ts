/**
 * The "Outside work" photo carousel's geometry (components/photo-carousel.tsx): photos sit on a
 * ring, the active one in front, and "next" turns the ring by one. No React, so it can be
 * unit-tested.
 */

/** `index` wrapped into 0..count-1, so "next" after the last photo is the first. */
export function wrapIndex(index: number, count: number): number {
  return ((index % count) + count) % count;
}

/**
 * Where photo `index` sits relative to the active one, the short way round the ring: 0 in
 * front, -1 its left neighbour, 1 its right one, and so on. With an even count, the photo
 * straight behind is +count/2.
 */
export function circularOffset(index: number, active: number, count: number): number {
  const offset = wrapIndex(index - active, count);
  return offset > count / 2 ? offset - count : offset;
}

/** How a photo is drawn at a given offset. `x` is a percentage of the card's own width. */
export interface Placement {
  x: number;
  z: number;
  rotateY: number;
  scale: number;
  opacity: number;
  zIndex: number;
  /** Out of sight (behind the ring): not clickable, hidden from screen readers. */
  hidden: boolean;
}

const FRONT: Placement = {
  x: 0,
  z: 0,
  rotateY: 0,
  scale: 1,
  opacity: 1,
  zIndex: 30,
  hidden: false,
};
const BEHIND: Placement = {
  x: 0,
  z: -420,
  rotateY: 0,
  scale: 0.6,
  opacity: 0,
  zIndex: 0,
  hidden: true,
};

/**
 * The ring seen from the front: neighbours turned away to each side and pushed back, the next
 * ones further out and fainter, the rest behind. A photo moving between offsets is animated
 * by CSS, so a turn of the ring looks like rotation.
 */
export function ringPlacement(offset: number, count: number): Placement {
  const distance = Math.abs(offset);
  const side = Math.sign(offset);
  // With an even number of photos, the one exactly opposite the front is behind the ring.
  const opposite = count > 2 && count % 2 === 0 && distance === count / 2;
  if (distance === 0) return FRONT;
  if (opposite || distance > 2) return BEHIND;
  if (distance === 1) {
    return {
      x: side * 62,
      z: -160,
      rotateY: -side * 30,
      scale: 0.86,
      opacity: 0.9,
      zIndex: 20,
      hidden: false,
    };
  }
  return {
    x: side * 100,
    z: -300,
    rotateY: -side * 42,
    scale: 0.72,
    opacity: 0.45,
    zIndex: 10,
    hidden: false,
  };
}
