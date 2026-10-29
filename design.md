# Design: agent-mem

The locked system. Every Hallmark run reads this first and screens share it. Change it on purpose; the file is the rule.

## System
- Genre: modern-minimal
- Shape of the first page: app screen
- Theme: Dusk (slate dark workspace, periwinkle signal, exact operational detail)
- Axes: slate dark glass/Wix Madefor/periwinkle-apricot signals · posture: Committed

## Tokens
`packages/web/src/tokens.css` is the source of truth. The roles:
```css
:root {
  --color-paper: var(--color-canvas);
  --color-paper-2: var(--color-panel);
  --color-paper-3: var(--color-panel-raised);
  --color-ink: oklch(96% 0.006 75);
  --color-ink-2: oklch(85% 0.010 262);
  --color-muted: oklch(70% 0.016 262);
  --color-rule: oklch(30% 0.016 266);
  --color-accent: oklch(77% 0.10 274);
  --color-accent-ink: oklch(19% 0.035 274);
  --color-focus: oklch(80% 0.10 274);
  --font-display: "Wix Madefor Display", ui-sans-serif, system-ui, sans-serif;
  --font-body: "Wix Madefor Text", ui-sans-serif, system-ui, sans-serif;
  --font-outlier: "IBM Plex Mono", ui-monospace, monospace;
  --radius-card: 18px;
  --radius-pill: 999px;
  --rule-hair: 1px;
  --shadow-card: inset 0 1px 0 oklch(99% 0.003 75 / 0.06), 0 24px 48px -32px oklch(8% 0.02 268 / 0.7);
}
```
The spacing scale, app type scale, easings, durations, glass and elevation variants live in `tokens.css`.

## Controls
- Primary: periwinkle pill with paired dark ink · 32px visual height with a 44px hit target
- Secondary: quiet text or a hairline outline · matching pill geometry and height
- Navigation: single-row workspace toolbar; ruled Sidebar view list with periwinkle selected icons and sentence-case labels
- Data regions: flat ruled panes and tables; elevated cards and dialogs use a lit top edge, with no cards inside cards

## Screens
- Board: shared instructions and sessions for the current agent selection above an adaptive wrapping grid of individual-agent panes, with live drag-and-drop memory cards
- Skills: adaptive wrapping library panes with the same alignment and density as Board
- Share matrix: sticky first column, horizontal rules and native/share states
- History: chronological rows with the existing undo action and empty state

## Motion
- Character: brisk; motion communicates drag, drawer, dialog and toast state only
- No page-load reveal or ambient pulse; under reduced motion everything ends at once

## Exports
`packages/web/src/tokens.css` in this project. Tailwind mappings live in `packages/web/src/styles.css`; DTCG or shadcn blocks are added here on request.
