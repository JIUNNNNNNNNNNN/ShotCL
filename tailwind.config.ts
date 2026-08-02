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
      fontFamily: {
        sans: [
          "Paperlogy",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Apple SD Gothic Neo",
          "Noto Sans KR",
          "sans-serif"
        ]
      },
      fontWeight: {
        normal: "100",
        black: "700"
      },
      colors: {
        field: {
          bg: "#121212",
          section: "#1E1E1E",
          panel: "#222222",
          soft: "#222222",
          input: "#252525",
          hover: "#272727",
          toast: "#2C2C2C",
          elevated: "#2D2D2D",
          floating: "#333333",
          overlay: "#353535",
          dialog: "#383838",
          primary: "#C8A951",
          secondary: "#D0B45A",
          light: "#272727",
          border: "rgba(255, 255, 255, 0.12)",
          divider: "rgba(255, 255, 255, 0.20)",
          text: "rgba(255, 255, 255, 0.87)",
          subtle: "rgba(255, 255, 255, 0.60)",
          muted: "rgba(255, 255, 255, 0.60)",
          disabled: "rgba(255, 255, 255, 0.38)",
          "accent-foreground": "#15130D",
          danger: "#E25555"
        },
        stage: {
          black: "#121212",
          panel: "#222222",
          line: "rgba(255, 255, 255, 0.12)",
          ink: "rgba(255, 255, 255, 0.87)",
          muted: "rgba(255, 255, 255, 0.60)",
          amber: "#C8A951",
          red: "#E25555"
        }
      },
      boxShadow: {
        shooting: "0 0 0 1px rgba(200, 169, 81, 0.45)",
        floating: "0 8px 24px rgba(0, 0, 0, 0.24)",
        dialog: "0 12px 32px rgba(0, 0, 0, 0.32)"
      }
    }
  },
  plugins: []
};

export default config;
