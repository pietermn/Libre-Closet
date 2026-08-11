# Libre Closet interface system

## Direction

Libre Closet should feel like a calm personal collection: a considered fashion contact sheet rather than a data dashboard. Garments are the focal point; controls stay quiet until they are needed. The primary accent is reserved for the next meaningful action, such as adding a garment or confirming a search.

## Foundations

- Use the DaisyUI semantic palette only: `base-*` surfaces carry the interface and `primary` marks the primary action or current destination.
- Use quiet layered surfaces: page `base-100`, recessed controls or image fields `base-200`, then a low-opacity `base-content/10` border. Prefer a `shadow-sm` or `shadow-md` lift over heavy outlines.
- Use the existing system sans serif. Hierarchy comes from weight, tracking, and opacity before size.
- Use a 4px spacing grid. Collection surfaces are deliberately compact: 8px control padding, 12px card padding, 16–20px grid gaps, and 24–32px between page sections.
- Keep radii semantic: `rounded-field` for controls and `rounded-box` for cards, trays, and larger grouped surfaces.

## Wardrobe index pattern

- Keep the page content centered at `max-w-6xl`, with `pt-20` to clear the fixed top navigation and `pb-28` to clear the floating dock.
- Lead with result count as a small primary eyebrow, then the page name as the single large visual anchor. Keep the add-garment action at the top right.
- Put keyword search, filters, and active filter pills in one compact search shelf above the grid. Do not use a fixed full-width search or filter bar; it competes with the dock and garment photos.
- Present garments as a responsive contact-sheet grid: two columns on phones, three on small screens, four on large screens, five on extra-large screens. Use portrait `aspect-[4/5]` image fields with `object-contain` and modest inner padding so cut-out garments have room to breathe.
- Item cards use a low-contrast border, `shadow-sm`, and a 150ms `transform, box-shadow` hover transition. Raise only `-translate-y-0.5` on hover; press feedback uses `scale(0.97)`. Respect reduced motion.
- Put category first in muted text and the garment name second in stronger text. Reserve badges for exceptional state, such as archived garments.
- Empty collections use one restrained dashed card with a clear add action, rather than a loose icon floating on the page.

## Floating navigation pattern

- The primary navigation is a centered, icon-first floating tray, no wider than 24rem. It has a `base-100/88` surface, a subtle border, and `backdrop-blur-xl`.
- Keep the visual label hidden while retaining a screen-reader label. The active destination is indicated with a `primary` icon tile, not a full-width tab.
- Every navigation target needs a minimum 44px hit area, visible keyboard focus, and an explicit `aria-current` state on the active route.

## Reusable interaction rules

- Use native elements and DaisyUI components: `btn`, `input`, `select`, `card`, `badge`, and HTML `dialog` via DaisyUI `modal`.
- Every icon-only control must have an accessible label.
- Use short, named transitions only: 150–200ms for press, hover, color, and transform. Never use `transition-all`.
- Make loading, empty, error, hover, active, focus, and disabled states deliberate for any new component.
