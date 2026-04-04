# Design Token Spec

## Purpose

This token sheet converts the phase 1 brand direction into implementation-ready design variables for UI design and frontend engineering.

## Typography Tokens

### Font Families

1. `font.display`: Fraunces, serif.
2. `font.body`: Space Grotesk, sans-serif.
3. `font.fallback-serif`: Georgia, serif.
4. `font.fallback-sans`: Arial, sans-serif.

### Type Scale

1. `type.hero`: 56/60 desktop, 40/44 tablet, 32/36 mobile.
2. `type.h1`: 40/44 desktop, 32/36 tablet, 28/32 mobile.
3. `type.h2`: 32/36 desktop, 28/32 tablet, 24/28 mobile.
4. `type.h3`: 24/28 desktop, 22/26 tablet, 20/24 mobile.
5. `type.h4`: 20/24 all breakpoints.
6. `type.body-lg`: 18/28.
7. `type.body-md`: 16/24.
8. `type.body-sm`: 14/20.
9. `type.caption`: 12/16.
10. `type.price-lg`: 28/32.
11. `type.price-md`: 22/26.

### Font Weights

1. `weight.regular`: 400.
2. `weight.medium`: 500.
3. `weight.semibold`: 600.
4. `weight.bold`: 700.

## Color Tokens

### Base

1. `color.ink.900`: #1E1A17.
2. `color.graphite.700`: #4E4A46.
3. `color.paper.100`: #F5EFE6.
4. `color.canvas.0`: #FFFDFC.
5. `color.mist.200`: #DDD3C7.

### Brand And Accent

1. `color.forest.700`: #335C4B.
2. `color.terracotta.600`: #B85C38.
3. `color.mustard.500`: #D4A43C.

### Functional

1. `color.success.bg`: #E5F1EC.
2. `color.success.fg`: #2E5A48.
3. `color.warning.bg`: #FFF3D8.
4. `color.warning.fg`: #8D6414.
5. `color.error.bg`: #FCE7E2.
6. `color.error.fg`: #A14A2C.
7. `color.info.bg`: #EEE8DF.
8. `color.info.fg`: #4E4A46.

### Surface Usage

1. `surface.page`: `color.paper.100`.
2. `surface.card`: `color.canvas.0`.
3. `surface.hero`: linear gradient from `#F4E8D8` to `#E9E0D2`.
4. `surface.highlight`: `#F8F0E6`.

### Text Usage

1. `text.primary`: `color.ink.900`.
2. `text.secondary`: `color.graphite.700`.
3. `text.inverse`: `color.canvas.0`.
4. `text.accent`: `color.forest.700`.

### Border Usage

1. `border.subtle`: `color.mist.200`.
2. `border.strong`: `#B8AA98`.
3. `border.accent`: `color.forest.700`.

## Spacing Tokens

1. `space.2`: 2px.
2. `space.4`: 4px.
3. `space.8`: 8px.
4. `space.12`: 12px.
5. `space.16`: 16px.
6. `space.20`: 20px.
7. `space.24`: 24px.
8. `space.32`: 32px.
9. `space.40`: 40px.
10. `space.48`: 48px.
11. `space.64`: 64px.
12. `space.80`: 80px.

## Radius Tokens

1. `radius.sm`: 8px.
2. `radius.md`: 14px.
3. `radius.lg`: 20px.
4. `radius.xl`: 28px.
5. `radius.pill`: 999px.

## Shadow Tokens

1. `shadow.sm`: 0 4px 12px rgba(30, 26, 23, 0.06).
2. `shadow.md`: 0 10px 24px rgba(30, 26, 23, 0.1).
3. `shadow.lg`: 0 18px 40px rgba(30, 26, 23, 0.12).

## Motion Tokens

1. `motion.fast`: 140ms.
2. `motion.base`: 220ms.
3. `motion.slow`: 320ms.
4. `ease.standard`: cubic-bezier(0.2, 0.8, 0.2, 1).
5. `ease.emphasis`: cubic-bezier(0.16, 1, 0.3, 1).

## Layout Tokens

1. `container.max`: 1280px.
2. `container.gutter.mobile`: 16px.
3. `container.gutter.tablet`: 24px.
4. `container.gutter.desktop`: 32px.
5. `grid.columns.mobile`: 4.
6. `grid.columns.tablet`: 8.
7. `grid.columns.desktop`: 12.

## Component-Level Tokens

1. `button.height.md`: 48px.
2. `button.height.lg`: 56px.
3. `input.height`: 48px.
4. `header.height.mobile`: 64px.
5. `header.height.desktop`: 80px.
6. `card.product.mediaRatio`: 4:5.
7. `rail.cardGap`: 16px.

## Notes For Implementation

1. These tokens should become the single source of truth for Figma and frontend code.
2. If final font licensing or performance changes force a typography substitution, update only the font family tokens and preserve the scale.
3. Promotional campaigns can vary imagery and accent usage, but should not add new base colors without review.