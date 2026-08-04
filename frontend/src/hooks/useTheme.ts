"use client";

import { useCallback, useEffect, useState } from "react";

export type ThemeChoice = "system" | "light" | "dark";

const STORAGE_KEY = "research-agent.theme";

/**
 * Theme preference. `system` leaves the OS in charge (the stylesheet's media
 * query); an explicit choice stamps `data-theme` on <html>, which the token
 * layer gives precedence over the media query in both directions.
 */
export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>("system");
  /**
   * The persist effect must not run before the stored value has been read —
   * otherwise the initial `"system"` default is written over an explicit
   * choice on every reload.
   */
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY) as ThemeChoice | null;
    if (stored === "light" || stored === "dark" || stored === "system") {
      setChoice(stored);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const root = document.documentElement;
    if (choice === "system") {
      root.removeAttribute("data-theme");
    } else {
      root.setAttribute("data-theme", choice);
    }
    window.localStorage.setItem(STORAGE_KEY, choice);
  }, [choice, hydrated]);

  /** Cycles system → light → dark → system. */
  const cycle = useCallback(() => {
    setChoice((current) =>
      current === "system" ? "light" : current === "light" ? "dark" : "system"
    );
  }, []);

  return { choice, setChoice, cycle };
}
