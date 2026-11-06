/**
 * The wording the template engine gives the screens — category names, the names of the starter templates and of their
 * slots and texts, and its refusals. The engine speaks English; the screens translate these when they show them, so
 * each one is listed here for the locale resources.
 */
const TEMPLATE_STRINGS = {
  categories: ["Vlog", "Promo", "Slideshow", "Intro and outro", "Social short", "Quote", "Other"],
  starters: ["Day in my life", "Travel recap", "Product spotlight", "Flash sale", "Memories", "Photo story", "Channel intro", "End screen", "Hook and reveal", "Top three", "Quote of the day", "Event countdown"],
  refusals: ["Give the template a name", "Open this project in the full editor before saving it as a template", "The template would embed more than 2 GiB of media. Turn more clips into slots.",
    "Enter a colour like #1e6bff", "A brand kit holds up to 24 colours", "A brand kit holds up to 10 fonts", "A brand kit holds up to 20 logos", "Logos can be up to 20 MB",
    "Give the pack a name", "Choose at least one preset", "A pack holds up to 2 000 presets", "This pack was made with a newer version of the app", "Package contains unsafe paths",
    "This template was made with a newer version of the app", "The pack holds no preset this version can use", "A starter template cannot be exported",
    "This audio cannot be replaced", "Choose an audio file", "Choose a sound at least as long as the slot"],
};
/** One line about each starter template, shown in its preview. */
const STARTER_DESCRIPTIONS: Record<string, string> = {
  "vlog-day": "Six quick clips of your day under a bold title, with a closing line at the end.",
  "vlog-travel": "Seven clips of a trip with a title card, the place and the date.",
  "promo-product": "Four square shots of a product with its name, a tagline and a price tag.",
  "promo-sale": "A vertical sale announcement in three beats: headline, offer and call to action.",
  "slideshow-memories": "Eight photos that fade into one another with a cinematic title and a date.",
  "slideshow-story": "Five portrait photos that slide upward under a short caption.",
  "intro-channel": "A six-second opener with your channel name in neon over one background clip.",
  "outro-end-screen": "An end screen with two video windows, a thank-you line and a subscribe button.",
  "short-hook": "A typed hook, two fast cuts and a bold reveal for a vertical short.",
  "short-top-three": "A numbered list of three clips, each with its own step label.",
  "quote-card": "A square quote card with the author over one background picture or clip.",
  "event-countdown": "An event announcement with its name, the date and a three-two-one countdown.",
};
export const starterDescription = (id: string): string | undefined => STARTER_DESCRIPTIONS[id];
export const templateStrings = (): readonly string[] => Object.values(TEMPLATE_STRINGS).flat();
