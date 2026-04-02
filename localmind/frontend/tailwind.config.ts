import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: "#0f0f10",
          1: "#18181b",
          2: "#27272a",
          3: "#3f3f46",
        },
        accent: {
          DEFAULT: "#6366f1",
          hover: "#4f46e5",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
