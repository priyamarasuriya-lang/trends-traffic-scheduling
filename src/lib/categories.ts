// Display metadata for media categories, shared by the timeline, media library and dashboard tiles.
export const CATEGORY_META: Record<string, { label: string; plural: string; slug: string; color: string; text: string }> = {
  PROGRAM: { label: "Program", plural: "Programs", slug: "programs", color: "#f4c14f", text: "#3b2a00" },
  MOVIE: { label: "Movie", plural: "Movies", slug: "movies", color: "#2fc5ae", text: "#003b33" },
  COMMERCIAL: { label: "Commercial", plural: "Commercials", slug: "commercials", color: "#ff6f59", text: "#3d0b02" },
  PROMO: { label: "Promo", plural: "Promos", slug: "promos", color: "#e3ae2f", text: "#3b2a00" },
  TIMER: { label: "Timer", plural: "Timers", slug: "timers", color: "#cbd5e1", text: "#1e293b" },
  SLIDE: { label: "Slide", plural: "Slides", slug: "slides", color: "#ffd166", text: "#3b2a00" },
  COMING_UP: { label: "Coming up", plural: "Coming Up", slug: "coming-up", color: "#f97316", text: "#3d1400" },
  FILLER: { label: "Filler", plural: "Fillers", slug: "fillers", color: "#34495e", text: "#ffffff" },
  NEW_MEDIA: { label: "New media", plural: "New Media", slug: "new-media", color: "#22b8cf", text: "#002a30" },
  SECONDARY: { label: "Secondary", plural: "Secondary graphics", slug: "secondary", color: "#dc2626", text: "#ffffff" },
};
export const SLUG_TO_CATEGORY = Object.fromEntries(Object.entries(CATEGORY_META).map(([k, v]) => [v.slug, k]));
