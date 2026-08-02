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
          bg: "#000000",
          panel: "#0D0D0D",
          soft: "#111111",
          primary: "#D7B95F",
          secondary: "#D7B95F",
          light: "#1A1A1A",
          border: "#303030",
          text: "#FFFFFF",
          muted: "#B5B5B5",
          danger: "#E25555"
        },
        stage: {
          black: "#000000",
          panel: "#0D0D0D",
          line: "#303030",
          ink: "#FFFFFF",
          muted: "#B5B5B5",
          amber: "#D7B95F",
          red: "#E25555"
        }
      },
      boxShadow: {
        shooting: "0 0 0 1px rgba(215, 185, 95, 0.55)"
      }
    }
  },
  plugins: []
};

export default config;
