import type { Bridge, IntroBridge } from "../../preload";

declare global {
  interface Window { amc?: Bridge; amcIntro?: IntroBridge }
}
