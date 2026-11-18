import { describe, expect, it } from 'vitest';
import { activeSection, updateVisible } from '@/lib/scroll-spy';

const ORDER = ['about', 'experience', 'projects', 'life', 'contact'];

describe('scrollspy', () => {
  it('highlights the section inside the band', () => {
    const visible = updateVisible(new Set(), [{ id: 'about', isIntersecting: true }]);
    expect(activeSection(visible, ORDER)).toBe('about');
  });

  it('highlights nothing once that section leaves and none replaces it (regression: back at the hero, "About" stayed lit)', () => {
    const reading = updateVisible(new Set(), [{ id: 'about', isIntersecting: true }]);
    const backAtTop = updateVisible(reading, [{ id: 'about', isIntersecting: false }]);

    expect(activeSection(backAtTop, ORDER)).toBeNull();
  });

  it('moves to the next section as it takes over the band', () => {
    let visible = updateVisible(new Set(), [{ id: 'about', isIntersecting: true }]);
    visible = updateVisible(visible, [
      { id: 'about', isIntersecting: false },
      { id: 'experience', isIntersecting: true },
    ]);
    expect(activeSection(visible, ORDER)).toBe('experience');
  });

  it('picks the earlier section when two touch the band at once', () => {
    const visible = updateVisible(new Set(), [
      { id: 'projects', isIntersecting: true },
      { id: 'experience', isIntersecting: true },
    ]);
    expect(activeSection(visible, ORDER)).toBe('experience');
  });
});
