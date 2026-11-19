import { useEffect, useRef } from "react";
import { useLocation } from "react-router";

const APP = "ReelSchedule";

/**
 * Following a link inside a single-page app loads no new document, so on its own the browser leaves focus on a
 * link that no longer exists (focus falls to <body>) and the tab title never changes. A keyboard user's next Tab
 * starts wherever that link used to be; a screen-reader user hears nothing at all (HW5 Task 7, a defect axe
 * cannot see).
 *
 * On every path change this waits for the new page's <h1> (loading placeholders have none), names the tab after
 * it and, except on the first load, moves focus to it, so the heading is read out and Tab continues from the top
 * of the new page. Query-string changes (the program's filters) are not page changes and leave focus alone.
 */
export function PageFocus() {
  const { pathname } = useLocation();
  const previous = useRef<string | null>(null);

  useEffect(() => {
    const main = document.getElementById("main");
    if (!main) return;
    // Compare with the last path rather than "first run", so React's development double-run is not a navigation.
    const moveFocus = previous.current !== null && previous.current !== pathname;
    previous.current = pathname;

    const apply = () => {
      const h1 = main.querySelector("h1");
      if (!h1) return false;
      document.title = `${h1.textContent?.trim() || APP} · ${APP}`;
      if (moveFocus) {
        if (!h1.hasAttribute("tabindex")) h1.setAttribute("tabindex", "-1");
        h1.focus();
      }
      return true;
    };
    if (apply()) return;
    const observer = new MutationObserver(() => {
      if (apply()) observer.disconnect();
    });
    observer.observe(main, { childList: true, subtree: true });
    const stop = setTimeout(() => observer.disconnect(), 15000);
    return () => {
      observer.disconnect();
      clearTimeout(stop);
    };
  }, [pathname]);

  return null;
}
