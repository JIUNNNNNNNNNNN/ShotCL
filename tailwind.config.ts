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
          bg: "#070807",
          section: "#111111",
          panel: "#161616",
          soft: "#161616",
          input: "#1D1D1D",
          hover: "#222222",
          toast: "#252525",
          elevated: "#292929",
          floating: "#2D2D2D",
          overlay: "#333333",
          dialog: "#383838",
          primary: "#D5FF40",
          secondary: "#E1FF72",
          strong: "#B7DD2D",
          "primary-soft": "rgba(213, 255, 64, 0.14)",
          "primary-soft-strong": "rgba(213, 255, 64, 0.22)",
          "primary-border": "rgba(213, 255, 64, 0.68)",
          "primary-focus": "rgba(213, 255, 64, 0.40)",
          light: "#222222",
          border: "rgba(255, 255, 255, 0.10)",
          divider: "rgba(255, 255, 255, 0.16)",
          text: "#FFFFFF",
          subtle: "#C0C2B8",
          muted: "#858A80",
          disabled: "#686B64",
          "accent-foreground": "#111111",
          danger: "#E25555"
        },
        status: {
          ok: "#D5FF40",
          warning: "#D5FF40"
        },
        stage: {
          black: "#070807",
          panel: "#161616",
          line: "rgba(255, 255, 255, 0.10)",
          ink: "#FFFFFF",
          muted: "#858A80",
          amber: "#D5FF40",
          red: "#E25555"
        }
      },
      boxShadow: {
        card: "0 1px 0 rgba(255, 255, 255, 0.035), 0 10px 28px rgba(0, 0, 0, 0.18)",
        shooting: "0 0 0 1px rgba(213, 255, 64, 0.68)",
        floating: "0 12px 34px rgba(0, 0, 0, 0.34)",
        dialog: "0 18px 48px rgba(0, 0, 0, 0.42)"
      }
    }
  },
  plugins: []
};

export default config;
