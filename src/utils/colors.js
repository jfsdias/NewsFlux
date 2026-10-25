import { generate, getRgbStr } from "@arco-design/color"

import { getSettings } from "@/store/settingsState"

export const accentFamilies = {
  Red: {
    name: "Editorial Crimson",
    dark: {
      accent: "#F05257",
      surface: "#271315",
      hover: "#381A1D",
      border: "#5C2025",
      onAccent: "#0B0D10",
      focus: "#FFA2A5",
      pressed: "#4A1F24",
    },
    light: {
      accent: "#C92A2A",
      surface: "#FFF5F5",
      hover: "#FFE3E3",
      border: "#FFA8A8",
      onAccent: "#FFFFFF",
      focus: "#E03131",
      pressed: "#A61E1E",
    },
  },
  Orange: {
    name: "Editorial Orange",
    dark: {
      accent: "#FF8A3D",
      surface: "#2B1B12",
      hover: "#3D2418",
      border: "#61341C",
      onAccent: "#0B0D10",
      focus: "#FFB885",
      pressed: "#4E2C1D",
    },
    light: {
      accent: "#B83A05",
      surface: "#FFF4E6",
      hover: "#FFE8CC",
      border: "#FFC078",
      onAccent: "#FFFFFF",
      focus: "#D9480F",
      pressed: "#9A2E03",
    },
  },
  Yellow: {
    name: "Editorial Gold",
    dark: {
      accent: "#E5B84B",
      surface: "#2A2314",
      hover: "#3C321C",
      border: "#5E4E25",
      onAccent: "#0B0D10",
      focus: "#F6D37E",
      pressed: "#4D4023",
    },
    light: {
      accent: "#8F5E00",
      surface: "#FFF9DB",
      hover: "#FFF3BF",
      border: "#F59F00",
      onAccent: "#FFFFFF",
      focus: "#B37700",
      pressed: "#6F4800",
    },
  },
  Green: {
    name: "Editorial Green",
    dark: {
      accent: "#34D071",
      surface: "#102519",
      hover: "#183524",
      border: "#225237",
      onAccent: "#0B0D10",
      focus: "#7DE5A7",
      pressed: "#1C422C",
    },
    light: {
      accent: "#237032",
      surface: "#EBFBEE",
      hover: "#D3F9D8",
      border: "#8CE99A",
      onAccent: "#FFFFFF",
      focus: "#2B8A3E",
      pressed: "#1C5827",
    },
  },
  Blue: {
    name: "Editorial Blue",
    dark: {
      accent: "#5B8CFF",
      surface: "#121C31",
      hover: "#1A2846",
      border: "#273D6B",
      onAccent: "#0B0D10",
      focus: "#9BBAFF",
      pressed: "#203257",
    },
    light: {
      accent: "#1864AB",
      surface: "#E7F5FF",
      hover: "#D0EBFF",
      border: "#74C0FC",
      onAccent: "#FFFFFF",
      focus: "#1C7ED6",
      pressed: "#134E85",
    },
  },
  Violet: {
    name: "Editorial Violet",
    dark: {
      accent: "#A876E8",
      surface: "#21172E",
      hover: "#2F2142",
      border: "#493268",
      onAccent: "#0B0D10",
      focus: "#CBB0F3",
      pressed: "#3C2B54",
    },
    light: {
      accent: "#6741D9",
      surface: "#F3F0FF",
      hover: "#E5DBFF",
      border: "#B197FC",
      onAccent: "#FFFFFF",
      focus: "#7950F2",
      pressed: "#5232B3",
    },
  },
}

export const colors = {
  Red: { light: accentFamilies.Red.light.accent, dark: accentFamilies.Red.dark.accent },
  Orange: { light: accentFamilies.Orange.light.accent, dark: accentFamilies.Orange.dark.accent },
  Yellow: { light: accentFamilies.Yellow.light.accent, dark: accentFamilies.Yellow.dark.accent },
  Green: { light: accentFamilies.Green.light.accent, dark: accentFamilies.Green.dark.accent },
  Blue: { light: accentFamilies.Blue.light.accent, dark: accentFamilies.Blue.dark.accent },
  Violet: { light: accentFamilies.Violet.light.accent, dark: accentFamilies.Violet.dark.accent },
}

export const isDarkMode = () => {
  const isSystemDark =
    typeof globalThis.matchMedia === "function" &&
    globalThis.matchMedia("(prefers-color-scheme: dark)").matches
  const themeMode = typeof getSettings === "function" ? getSettings("themeMode") : "system"
  return themeMode === "system" ? Boolean(isSystemDark) : themeMode === "dark"
}

export const getAccentFamily = (colorName) => {
  return accentFamilies[colorName] || accentFamilies.Blue
}

export const getDisplayColorValue = (colorName, isDark = isDarkMode()) => {
  const family = getAccentFamily(colorName)
  return isDark ? family.dark.accent : family.light.accent
}

export const getColorValue = (colorName, isDark = isDarkMode()) => {
  const family = getAccentFamily(colorName)
  return isDark ? family.dark.accent : family.light.accent
}

export const applyColor = (colorName, isDark = isDarkMode()) => {
  const resolvedColorName = accentFamilies[colorName] ? colorName : "Blue"
  const family = getAccentFamily(resolvedColorName)
  const tokens = isDark ? family.dark : family.light

  if (typeof document !== "undefined" && document.body?.style) {
    const colorPalette = generate(tokens.accent, { list: true }).map((color) => getRgbStr(color))
    for (const [index, color] of colorPalette.entries()) {
      document.body.style.setProperty(`--primary-${index + 1}`, color)
    }

    document.body.style.setProperty("--nf-accent", tokens.accent)
    document.body.style.setProperty("--nf-accent-surface", tokens.surface)
    document.body.style.setProperty("--nf-accent-hover", tokens.hover)
    document.body.style.setProperty("--nf-accent-border", tokens.border)
    document.body.style.setProperty("--nf-on-accent", tokens.onAccent)
    if (tokens.focus) {
      document.body.style.setProperty("--nf-accent-focus", tokens.focus)
    }
    if (tokens.pressed) {
      document.body.style.setProperty("--nf-accent-pressed", tokens.pressed)
    }
    document.body.setAttribute("color-name", resolvedColorName)
  }
}
