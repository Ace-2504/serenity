import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1F2E3A",
        paper: "#EAF2F4",
        canvas: "#F8FCFC",
        forest: "#2F6F68",
        terracotta: "#C97862",
        mustard: "#CDB07A",
        graphite: "#566674",
        mist: "#C8D8DF",
        "mist-light": "#DEE9EE",
        sage: "#80AFA4"
      },
      fontFamily: {
        display: ["var(--font-fraunces)", "Georgia", "serif"],
        body: ["var(--font-space-grotesk)", "Arial", "sans-serif"]
      },
      boxShadow: {
        panel: "0 14px 36px rgba(31, 46, 58, 0.14)"
      },
      borderRadius: {
        xl2: "1.25rem"
      }
    }
  },
  plugins: []
};

export default config;