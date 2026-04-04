type ProductImageInput = {
  slug?: string;
  sku?: string;
  title?: string;
  categorySlug?: string;
};

const PRODUCT_IMAGE_BY_SLUG: Record<string, { src: string; position?: string }> = {
  "a4-artist-sketchbook": { src: "/product-images/a4 sketchbook.jpeg", position: "object-center" },
  "a5-premium-journal": { src: "/product-images/shopping.webp", position: "object-center" },
  "ball-pen-everyday-pack": { src: "/product-images/ball pen set.webp", position: "object-center" },
  "classic-ruled-notebook-a5": { src: "/product-images/ruled a5 notebook.webp", position: "object-center" },
  "dotted-bullet-journal-a5": { src: "/product-images/shopping.webp", position: "object-center" },
  "dual-tip-marker-kit": { src: "/product-images/dual tip marker set.webp", position: "object-center" },
  "fine-gel-pen-set": { src: "/product-images/gel pen set.jpeg", position: "object-center" },
  "fine-liner-marker-pack": { src: "/product-images/fine line marker set.webp", position: "object-center" },
  "hardbound-daily-journal": { src: "/product-images/hardbound journal.jpeg", position: "object-center" },
  "magnetic-bookmark-set": { src: "/product-images/magnetic bookmark set.webp", position: "object-center" },
  "minimal-desk-organizer": { src: "/product-images/minimal desk organizer set.jpeg", position: "object-center" },
  "monthly-habit-tracker-journal": { src: "/product-images/shopping.webp", position: "object-center" },
  "sketch-pencil-starter-set": { src: "/product-images/sketch pencil starter kit.jpeg", position: "object-center" },
  "smooth-gel-pen-set": { src: "/product-images/gel pen set.jpeg", position: "object-center" },
  "sticky-notes-multi-pack": { src: "/product-images/sticky notes multi pack.jpeg", position: "object-center" },
  "undated-goal-diary": { src: "/product-images/shopping.webp", position: "object-center" },
  "watercolor-brush-pen-set": { src: "/product-images/watercolor brush pen set.jpeg", position: "object-center" },
  "weekly-productivity-planner": { src: "/product-images/shopping.webp", position: "object-center" },
  "classmate-notebook": { src: "/product-images/classmate notebook.jpeg", position: "object-center" }
};

const PRODUCT_SLUG_BY_SKU: Record<string, string> = {
  "DUMMY-ARTSUPPL-2": "a4-artist-sketchbook",
  "SKU-A5-JOURNAL-001": "a5-premium-journal",
  "DUMMY-PENSANDW-3": "ball-pen-everyday-pack",
  "DUMMY-NOTEBOOK-1": "classic-ruled-notebook-a5",
  "DUMMY-NOTEBOOK-2": "dotted-bullet-journal-a5",
  "SKU-MARKER-KIT-024": "dual-tip-marker-kit",
  "SKU-GEL-PEN-SET-010": "fine-gel-pen-set",
  "DUMMY-PENSANDW-2": "fine-liner-marker-pack",
  "DUMMY-NOTEBOOK-3": "hardbound-daily-journal",
  "DUMMY-DESKACCE-3": "magnetic-bookmark-set",
  "DUMMY-DESKACCE-1": "minimal-desk-organizer",
  "DUMMY-PLANNERS-3": "monthly-habit-tracker-journal",
  "DUMMY-ARTSUPPL-1": "sketch-pencil-starter-set",
  "DUMMY-PENSANDW-1": "smooth-gel-pen-set",
  "DUMMY-DESKACCE-2": "sticky-notes-multi-pack",
  "DUMMY-PLANNERS-2": "undated-goal-diary",
  "DUMMY-ARTSUPPL-3": "watercolor-brush-pen-set",
  "DUMMY-PLANNERS-1": "weekly-productivity-planner",
  "NOTEBOOK": "classmate-notebook"
};

const PRODUCT_SLUG_BY_TITLE: Record<string, string> = {
  "a4 artist sketchbook": "a4-artist-sketchbook",
  "a5 premium journal": "a5-premium-journal",
  "ball pen everyday pack": "ball-pen-everyday-pack",
  "classic ruled notebook a5": "classic-ruled-notebook-a5",
  "dotted bullet journal a5": "dotted-bullet-journal-a5",
  "dual tip marker kit": "dual-tip-marker-kit",
  "fine gel pen set": "fine-gel-pen-set",
  "fine liner marker pack": "fine-liner-marker-pack",
  "hardbound daily journal": "hardbound-daily-journal",
  "magnetic bookmark set": "magnetic-bookmark-set",
  "minimal desk organizer": "minimal-desk-organizer",
  "monthly habit tracker journal": "monthly-habit-tracker-journal",
  "sketch pencil starter set": "sketch-pencil-starter-set",
  "smooth gel pen set": "smooth-gel-pen-set",
  "sticky notes multi pack": "sticky-notes-multi-pack",
  "undated goal diary": "undated-goal-diary",
  "watercolor brush pen set": "watercolor-brush-pen-set",
  "weekly productivity planner": "weekly-productivity-planner",
  "classmate notebook": "classmate-notebook"
};

function normalizeTitle(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function resolveSlug(input: ProductImageInput): string | undefined {
  if (input.slug && PRODUCT_IMAGE_BY_SLUG[input.slug]) {
    return input.slug;
  }

  if (input.sku && PRODUCT_SLUG_BY_SKU[input.sku]) {
    return PRODUCT_SLUG_BY_SKU[input.sku];
  }

  if (input.title) {
    const normalized = normalizeTitle(input.title);
    if (PRODUCT_SLUG_BY_TITLE[normalized]) {
      return PRODUCT_SLUG_BY_TITLE[normalized];
    }
  }

  return undefined;
}

const CATEGORY_FALLBACK: Record<string, { src: string; position?: string }> = {
  "notebooks-and-journals": { src: "/product-images/ruled a5 notebook.webp", position: "object-center" },
  "pens-and-writing": { src: "/product-images/gel pen set.jpeg", position: "object-center" },
  "art-supplies": { src: "/product-images/a4 sketchbook.jpeg", position: "object-center" },
  "desk-accessories": { src: "/product-images/minimal desk organizer set.jpeg", position: "object-center" },
  "planners-and-diaries": { src: "/product-images/shopping.webp", position: "object-center" }
};

export function getProductImage(input: ProductImageInput): { src: string; position: string; alt: string } {
  const slug = resolveSlug(input);
  const title = input.title ?? slug ?? "Stationery product";

  if (slug) {
    return {
      src: PRODUCT_IMAGE_BY_SLUG[slug].src,
      position: PRODUCT_IMAGE_BY_SLUG[slug].position ?? "object-center",
      alt: `${title} image`
    };
  }

  if (input.categorySlug && CATEGORY_FALLBACK[input.categorySlug]) {
    const match = CATEGORY_FALLBACK[input.categorySlug];
    return {
      src: match.src,
      position: match.position ?? "object-center",
      alt: `${title} image`
    };
  }

  return {
    src: "/product-images/shopping.webp",
    position: "object-center",
    alt: `${title} image`
  };
}
