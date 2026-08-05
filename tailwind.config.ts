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
          primary: "#F0FF3D",
          secondary: "#F5FF70",
          strong: "#D9EA2D",
          "primary-soft": "rgba(240, 255, 61, 0.14)",
          "primary-soft-strong": "rgba(240, 255, 61, 0.22)",
          "primary-border": "rgba(240, 255, 61, 0.72)",
          "primary-focus": "rgba(240, 255, 61, 0.42)",
          light: "#272727",
          border: "rgba(255, 255, 255, 0.09)",
          divider: "rgba(255, 255, 255, 0.14)",
          text: "#F7F8F2",
          subtle: "#C0C2B8",
          muted: "#82877C",
          disabled: "#6F6F6F",
          "accent-foreground": "#111111",
          danger: "#E25555"
        },
        status: {
          ok: "#9A8956",
          warning: "#9A8956"
        },
        stage: {
          black: "#121212",
          panel: "#222222",
          line: "rgba(255, 255, 255, 0.09)",
          ink: "#F7F8F2",
          muted: "#82877C",
          amber: "#F0FF3D",
          red: "#E25555"
        }
      },
      boxShadow: {
        card: "0 1px 0 rgba(255, 255, 255, 0.025), 0 8px 24px rgba(0, 0, 0, 0.12)",
        shooting: "0 0 0 1px rgba(240, 255, 61, 0.72)",
        floating: "0 10px 28px rgba(0, 0, 0, 0.28)",
        dialog: "0 18px 48px rgba(0, 0, 0, 0.42)"
      }
    }
  },
  plugins: []
};

export default config;
