export const AppConstants = {
  TEMPLATE_PATH: "assets/images/template.png",

  FONT_PATH: "assets/fonts/Prompt-Bold.ttf",
  FONT_NAME: "Prompt",

  HEIGHT: "height",
  WIDTH: "width",

  MIN_WIDTH: 1,
  MIN_HEIGHT: 1,
  MAX_WIDTH: 1500, // iPhone 17 Pro Max 1320 x 2868
  MAX_HEIGHT: 3000,

  // caps distinct w x h combos held in memory at once; RPi 3B+ only has 1GB RAM
  MAX_CACHED_IMAGES: 8,
} as const;
