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
          bg: "#0E1013",
          panel: "#14171B",
          soft: "#191D22",
          elevated: "#1D2127",
          hover: "#232830",
          input: "#121519",
          primary: "#C8A951",
          secondary: "#D0B45A",
          light: "#232830",
          border: "#2B3038",
          divider: "#3A414B",
          text: "#ECEFF3",
          subtle: "#B4BAC3",
          muted: "#858D98",
          disabled: "#626A74",
          "accent-foreground": "#15130D",
          danger: "#E25555"
        },
        stage: {
          black: "#0E1013",
          panel: "#14171B",
          line: "#2B3038",
          ink: "#ECEFF3",
          muted: "#858D98",
          amber: "#C8A951",
          red: "#E25555"
        }
      },
      boxShadow: {
        shooting: "0 0 0 1px rgba(200, 169, 81, 0.45)"
      }
    }
  },
  plugins: []
};

export default config;
