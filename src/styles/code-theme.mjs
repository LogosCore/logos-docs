// Code block themes in grayscale, like the rest of the site: Tailwind's
// neutral scale, which core's UI uses. Starlight's default (Night Owl) is
// colour; here three inks tell tokens apart instead: strong for keys,
// keywords and names, text for the rest of the code, muted for strings,
// comments and punctuation. Keywords are bold and comments italic.
// Expressive Code raises any ink below 5.5:1 contrast with the background.

const inks = {
  dark: {
    bg: "#262626", // neutral-800: Starlight paints code on --sl-color-gray-6
    strong: "#fafafa", // neutral-50
    text: "#d4d4d4", // neutral-300, the page's body text
    muted: "#a3a3a3", // neutral-400
    faint: "#737373", // neutral-500
    selection: "#ffffff26",
  },
  light: {
    bg: "#f5f5f5", // neutral-100: --sl-color-gray-7
    strong: "#0a0a0a", // neutral-950
    text: "#404040", // neutral-700, the page's body text
    muted: "#737373", // neutral-500
    faint: "#a3a3a3", // neutral-400
    selection: "#0000001f",
  },
};

function codeTheme(type) {
  const c = inks[type];
  return {
    name: `logos-mono-${type}`,
    type,
    colors: {
      "editor.background": c.bg,
      "editor.foreground": c.text,
      "editor.selectionBackground": c.selection,
      "editorLineNumber.foreground": c.faint,
      "editorLineNumber.activeForeground": c.text,
      focusBorder: c.muted,
      "menu.selectionBackground": c.selection,
      "menu.selectionForeground": c.strong,
    },
    tokenColors: [
      {
        scope: ["string", "punctuation"],
        settings: { foreground: c.muted },
      },
      {
        scope: ["comment", "punctuation.definition.comment"],
        settings: { foreground: c.muted, fontStyle: "italic" },
      },
      {
        scope: ["constant.character.escape"],
        settings: { foreground: c.text },
      },
      {
        scope: ["keyword", "storage.modifier"],
        settings: { foreground: c.strong, fontStyle: "bold" },
      },
      {
        scope: ["keyword.operator"],
        settings: { foreground: c.text, fontStyle: "" },
      },
      {
        scope: [
          "support.type.property-name",
          "meta.object-literal.key",
          "entity.name.tag",
          "entity.name.function",
          "support.function",
          "entity.name.type",
          "entity.name.class",
          "support.class",
          "storage.type",
        ],
        settings: { foreground: c.strong },
      },
    ],
  };
}

export const codeThemes = [codeTheme("dark"), codeTheme("light")];
