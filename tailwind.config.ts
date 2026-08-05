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
        normal: "400",
        black: "700"
      },
      colors: {
        field: {
          bg: "#080A08",
          section: "#10120F",
          panel: "#151814",
          soft: "#151814",
          input: "#0D0F0C",
          hover: "#1B1F19",
          toast: "#1B1F19",
          elevated: "#1B1F19",
          floating: "#22271F",
          overlay: "#1B1F19",
          dialog: "#151814",
          primary: "#D5FF40",
          secondary: "#E1FF72",
          strong: "#B7DD2D",
          light: "#1B1F19",
          border: "rgba(255, 255, 255, 0.09)",
          divider: "rgba(255, 255, 255, 0.14)",
          text: "#F7F8F2",
          subtle: "#C0C2B8",
          muted: "#82877C",
          disabled: "#5E635A",
          "accent-foreground": "#090B08",
          danger: "#E25555"
        },
        status: {
          ok: "#9A8956",
          warning: "#9A8956"
        },
        stage: {
          black: "#080A08",
          panel: "#151814",
          line: "rgba(255, 255, 255, 0.09)",
          ink: "#F7F8F2",
          muted: "#82877C",
          amber: "#D5FF40",
          red: "#E25555"
        }
      },
      boxShadow: {
        card: "0 1px 0 rgba(255, 255, 255, 0.025), 0 8px 24px rgba(0, 0, 0, 0.12)",
        shooting: "0 0 0 1px rgba(213, 255, 64, 0.42)",
        floating: "0 10px 28px rgba(0, 0, 0, 0.28)",
        dialog: "0 18px 48px rgba(0, 0, 0, 0.42)"
      }
    }
  },
  plugins: []
};

export default config;
