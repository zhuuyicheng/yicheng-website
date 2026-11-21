# Editing the Website's Text

Every word on the site lives in one of two places:

| Kind of text                                                                          | Where it lives                           | How a change shows up                        |
| ------------------------------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------- |
| **Your content**: name, headline, about, experience, education, projects, links       | `apps/api/content/portfolio.json` (data) | `npm run content:seed`, then reload the page |
| **Page wording**: section titles, buttons, header, footer, form messages, other pages | `.tsx` files in `apps/web/src` (code)    | Save the file; the browser updates by itself |

Rule of thumb: if the text is about **you**, it's in the JSON. If it would be the same on
anyone's portfolio built from this code, it's in the code.

**Finding any text**: in VS Code press **Ctrl+Shift+F**, paste a few exact words you see on
the page, and set _files to include_ to `apps/web/src, apps/api/content`. The result tells you
which of the two places it is. If nothing matches, the text is assembled from pieces: the home
page's browser-tab title, for example, is `fullName · headline` from the JSON.

Have the site running while you edit (three terminals): `npm run infra:up` once, then
`npm run dev:api` and `npm run dev:web`, and open http://localhost:3000.

---

## 1. Your content: `portfolio.json`

**Do**

1. Edit [apps/api/content/portfolio.json](../apps/api/content/portfolio.json).
2. Run `npm run content:seed`.
3. Reload http://localhost:3000.

**Which field appears where**

| Field                            | On the site                                                                                                                 |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `profile.fullName`               | The big name in the hero, and the home page's browser-tab title                                                             |
| `profile.headline`               | The line under your name, and the browser-tab title                                                                         |
| `profile.summary`                | The About section. A blank line (`\n\n`) starts a new paragraph. Its first 160 characters are the search-engine description |
| `profile.location`               | About sidebar; `null` hides it                                                                                              |
| `profile.links`                  | Buttons in the hero and links in the About sidebar, in file order                                                           |
| `experiences`, `education`       | The Experience & education timeline, in file order. `"endDate": null` shows "present"                                       |
| `projects[].title`, `.summary`   | The project cards                                                                                                           |
| `projects[].description`         | The overview at the top of the project's own page, `/<slug>`. A blank line (`\n\n`) starts a new paragraph                  |
| `projects[].sections`            | The rest of the project's page, in file order: see below                                                                    |
| `projects[].techStack`           | Tags on the card and the project's page, and the technology filter above the cards                                          |
| `projects[].featured`            | `true` lists the project first, with a "Featured" badge; the others follow in file order                                    |
| `projects[].repoUrl`, `.liveUrl` | Buttons on the project's page (never on the card); `null` hides them                                                        |

**Project sections** give a project page its structure. Each one becomes a heading (also
listed under "On this page" on wide screens), then its `body` as paragraphs, then its `points`
as a bulleted list. Either `body` or `points` may be left out, but not both:

```json
"sections": [
  {
    "heading": "Spare guide",
    "body": "For the pins left standing, the guide shows where to stand and where to aim.",
    "points": ["Available during a game and as a separate Guide tab."]
  },
  { "heading": "Tools", "body": "Python, PyTorch and NumPy." }
]
```

**The seed makes the site match the file exactly.** Delete a project or a role from the file,
seed, and it's gone from the site. Renaming a project's `slug` changes its address, so old
links to `/<old-slug>` stop working. A few slugs are taken by the site's own pages (`admin`,
`projects`, `privacy`); the seed refuses them.

**"Last updated" follows your edits.** A project page's date moves when you change that
project, moving it up or down the list included. The home page's date moves when you change
anything, a project included. Seeding (or deploying) an unchanged file moves nothing.

**JSON pitfalls** (VS Code underlines them in red):

- Text goes inside double quotes; a `"` inside the text is written `\"`.
- No comma after the last item of a list or object.
- A new paragraph inside text is `\n\n`.
- Length limits: summary 2,000 characters, each highlight 500, a project description 10,000;
  per project at most 20 sections, a section heading 120, its body 2,000, each point 500.

If anything is wrong, the seed lists **every** problem with its location and writes nothing,
so the site never shows half an edit. Try it on purpose:
[Guided Tour, Station 5](GUIDED-TOUR.md#station-5-edit-your-content-and-break-it-on-purpose).

---

## 2. Page wording: the `.tsx` files

| What you see                                                                           | File (in `apps/web/src/`)                                                                                         |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Section titles: About Me, Experience & education, Projects, Outside work, Get in touch | `app/page.tsx`, the `<SectionHeading title="…" />` lines                                                          |
| The "View projects" and "Get in touch" buttons                                         | `components/hero.tsx`                                                                                             |
| Header: your name and the section links                                                | `components/site-header.tsx` (`SECTIONS` at the top)                                                              |
| Project cards: "Read more", "Featured"                                                 | `components/project-card.tsx`                                                                                     |
| Project page: "Back to projects", "Next project", "On this page"                       | `app/[slug]/page.tsx`, `components/project-contents.tsx`                                                          |
| Footer links (About, Projects, Contact)                                                | `components/site-footer.tsx`                                                                                      |
| Contact form: labels and hints                                                         | `components/contact-form.tsx`                                                                                     |
| Contact form replies ("Message sent…", the spam-limit explanation, errors)             | `lib/contact.ts` (`sentMessage`, `rateLimitedMessage`, `sendContact`)                                             |
| Photo captions and descriptions ("Outside work")                                       | `content/photos.ts`                                                                                               |
| Section icons                                                                          | `app/page.tsx`, the `icon={…}` of each `<SectionHeading … />` (names from [lucide.dev](https://lucide.dev/icons)) |
| Browser-tab icon                                                                       | `app/icon.svg` (the "YC" monogram)                                                                                |
| Browser-tab title of the other pages (`… · Portfolio`) and the default description     | `app/layout.tsx` (`metadata`)                                                                                     |
| The 404 page and your owner dashboard                                                  | `app/not-found.tsx`, `app/admin/page.tsx`                                                                         |
| The "back soon" page while the site is paused ([CD.md §5](CD.md#5-pausing-the-site))   | `deploy/caddy/back-soon.html` (outside `apps/web`; repeats your LinkedIn link)                                    |

**Editing JSX safely.** These files mix HTML-like tags with code. Change only the words:

```tsx
<p>Built with Next.js, Fastify, PostgreSQL and Redis.</p>   ← words between tags: change freely
<SectionHeading title="Get in touch" icon={Mail} />
                       ↑ words inside quotes: change freely
```

- Leave the tags (`<p …>`, `</p>`) and `className="…"` (styling) as they are.
- `{' '}` is a deliberate space between two pieces; keep it.
- Apostrophes and quotes can be typed as they are (the existing files write `&apos;` and
  `&quot;`; both work). The characters `{ } < >` can't appear in plain text: write `&lt;` and
  `&gt;` for `<` and `>`, and ask for help if you need braces.
- If the browser shows a red error overlay after saving, the last edit broke the syntax: undo
  it (Ctrl+Z, save) and look at what changed.

Because this is code, run `npm run format` and `npm run lint` before committing (or
`npm run check` for everything CI runs).

---

## 3. Photos

The photos live in `apps/web/src/content/photos/`, and `apps/web/src/content/photos.ts` lists
the ones in the "Outside work" carousel, in the order it shows them. Each entry has:

| Field         | What it does                                                                                                                                                |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src`         | The image, imported at the top of the file                                                                                                                  |
| `alt`         | What the picture shows, for people who cannot see it (screen readers)                                                                                       |
| `caption`     | The title under the photo while it is in front                                                                                                              |
| `description` | Optional: a sentence or two under the caption                                                                                                               |
| `focus`       | Optional: the part kept in view when the photo is cropped to the portrait card, as `"x% y%"` (from the left, from the top). Default `"50% 50%"`, the centre |

Changing a caption: edit the text and save; the page updates by itself.

The same file lists `HERO_PHOTOS`: the collage beside your name at the top. The first one is
the large photo in the middle; the next six are pinned around it, tilted (on phones only the
first five show). Reorder them to change which photo sits where; each entry has `src`, `alt`
and an optional `focus`. The header avatar (`avatar.jpg`) is a crop of the first.

To add a photo, first make a web copy: at most 1,600 pixels on its long side, and **without
its metadata**, because phone photos often carry the GPS position where they were taken and
anything committed here is published. From the repository root:

```bash
node -e "require('sharp')(process.argv[1]).rotate().resize({ width: 1600, height: 1600, fit: 'inside' }).jpeg({ quality: 80, mozjpeg: true }).toFile(process.argv[2])" ~/Pictures/IMG_1234.jpg apps/web/src/content/photos/my-photo.jpg
```

(`sharp` comes with Next.js; it drops metadata unless told to keep it, and `.rotate()` first
applies the phone's orientation.) Then, in `photos.ts`, import it at the top like the others
(`import myPhoto from './photos/my-photo.jpg';`) and add an entry where you want it in the
carousel:

```ts
  {
    src: myPhoto,
    alt: 'Yicheng cycling along a coastal road at sunset',
    caption: 'Weekend rides',
    focus: '50% 60%',
  },
```

Saving updates the page; there is no seed step for photos.

---

## 4. Getting a change onto the live site

Every change travels the same way: commit → push → pull request → CI green → merge → approve
the deploy ([CD.md §3](CD.md#3-releasing)). The deploy runs the seed itself, so you never run
`content:seed` against production by hand.

There is no editing page: Git is the editor (`/admin` only reads). Every change is checked by
CI, has a history, and can be rolled back by deploying the previous version.

---

## Check yourself

<details><summary>1. You changed your headline in portfolio.json and reloaded, but the site still shows the old one. What's missing?</summary>

`npm run content:seed`. The website reads from the API, the API from Postgres (through
Redis), and only the seed copies the file into Postgres and refreshes the cache.

</details>

<details><summary>2. You want "Get in touch" to read "Contact me". Which file, and do you need to seed?</summary>

`apps/web/src/app/page.tsx`, the `title` of the last `<SectionHeading … />`. No seed: it's
page wording (code), so saving the file is enough while `npm run dev:web` runs.

</details>

<details><summary>3. Why isn't the home page's browser-tab title in <code>layout.tsx</code> like the others?</summary>

It's built from your data: `generateMetadata` in `app/page.tsx` combines `fullName` and
`headline` from the JSON. Change those two fields and the title follows.

</details>
