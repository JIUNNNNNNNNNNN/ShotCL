import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./hooks/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        field: {
          bg: "#FCFBF7",
          soft: "#F7F5EF",
          primary: "#0F3D2E",
          secondary: "#1F6B4A",
          light: "#EDF4EF",
          border: "#DED9CF",
          text: "#1C1C1A",
          muted: "#6B6B63",
          danger: "#9B2C2C"
        },
        stage: {
          black: "#FFFFFF",
          panel: "#FAFAF7",
          line: "#E5E2DA",
          ink: "#1C1C1A",
          muted: "#6B6B63",
          amber: "#0F3D2E",
          cyan: "#1F6B4A",
          green: "#0F3D2E",
          red: "#9B2C2C"
        }
      },
      boxShadow: {
        shooting: "0 0 0 1px rgba(15, 61, 46, 0.24), 0 14px 28px rgba(15, 61, 46, 0.12)"
      }
    }
  },
  plugins: []
};

export default config;
