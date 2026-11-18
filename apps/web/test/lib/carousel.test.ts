import { describe, expect, it } from 'vitest';
import { circularOffset, ringPlacement, wrapIndex } from '@/lib/carousel';

describe('photo carousel ring', () => {
  it('wraps round in both directions', () => {
    expect(wrapIndex(4, 4)).toBe(0);
    expect(wrapIndex(-1, 4)).toBe(3);
    expect(wrapIndex(2, 4)).toBe(2);
  });

  it('measures each photo from the active one, the short way round', () => {
    // Four photos, the second (index 1) in front.
    expect([0, 1, 2, 3].map((index) => circularOffset(index, 1, 4))).toEqual([-1, 0, 1, 2]);
    // Five photos, the first in front: two on each side.
    expect([0, 1, 2, 3, 4].map((index) => circularOffset(index, 0, 5))).toEqual([0, 1, 2, -2, -1]);
  });

  it('puts the active photo in front and its neighbours on either side, mirrored', () => {
    const front = ringPlacement(0, 4);
    const left = ringPlacement(-1, 4);
    const right = ringPlacement(1, 4);

    expect(front).toMatchObject({ x: 0, scale: 1, opacity: 1, hidden: false });
    expect(left.x).toBe(-right.x);
    expect(left.rotateY).toBe(-right.rotateY);
    expect(right.zIndex).toBeLessThan(front.zIndex);
  });

  it('hides the photo straight behind the ring, and anything further than two away', () => {
    expect(ringPlacement(2, 4).hidden).toBe(true); // opposite the front of four
    expect(ringPlacement(2, 5).hidden).toBe(false); // five: two visible on each side
    expect(ringPlacement(3, 8).hidden).toBe(true);
  });

  it('shows both photos when there are only two', () => {
    expect(ringPlacement(1, 2).hidden).toBe(false);
  });
});
