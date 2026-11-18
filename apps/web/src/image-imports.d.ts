// Types for imported images (`import photo from './photo.jpg'` is a StaticImageData).
// Next.js references them from next-env.d.ts too, but that file is generated and gitignored:
// on a fresh checkout (CI) it does not exist until `next typegen` or `next build` runs, and
// lint runs before either, so every photo import would be an unknown, "error" type.
/// <reference types="next/image-types/global" />
