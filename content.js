(() => {
  "use strict";

  // Extension storage is shared across both products and all their open tabs.
  const STORAGE_KEY = "prairieDarkModeEnabled";
  const ROOT_ATTRIBUTE = "data-prairie-darkmode";
  const BUTTON_ID = "prairie-darkmode-toggle";
  const COURSE_SELECTOR = ".cs128-wrap";
  const SURFACE_ATTRIBUTE = "data-prairie-darkmode-surface";
  const TEXT_ATTRIBUTE = "data-prairie-darkmode-text";
  // Course figures, editors, controls, and syntax highlighting own their colors.
  const COURSE_EXCLUSIONS = "img, picture, svg, canvas, video, iframe, math, mjx-container, pre, code, kbd, samp, button, input, textarea, select, .ace_editor";
  const root = document.documentElement;
  if (!root || root.hasAttribute(ROOT_ATTRIBUTE)) return;

  let enabled = true;
  let revision = 0;
  let queued = false;
  let courseFrame = 0;
  let button;
  let icon;
  let label;

  function render() {
    // Only "dark" activates theme rules; "light" restores the site's styles.
    root.setAttribute(ROOT_ATTRIBUTE, enabled ? "dark" : "light");
    scheduleCourseTheme();
    if (!button) return;
    button.setAttribute("aria-pressed", String(enabled));
    button.title = enabled ? "Switch to light mode" : "Switch to dark mode";
    icon.textContent = enabled ? "☾" : "☀";
    label.textContent = enabled ? "Dark mode" : "Light mode";
  }

  function mountToggle() {
    queued = false;
    // Both products use .navbar; skip their separate accessibility/skip-link nav.
    const navbar = document.querySelector(".navbar");
    if (!navbar) return;
    const container = navbar.querySelector(":scope > .container-fluid, :scope > .container");
    // At document_start the parser may not have created the container yet.
    if (!container) return;
    navbar.classList.add("prairie-darkmode-navbar");
    container.classList.add("prairie-darkmode-nav-container");

    if (!button) {
      button = document.createElement("button");
      button.id = BUTTON_ID;
      button.className = "prairie-darkmode-toggle";
      button.type = "button"; // Never submits a surrounding form.
      button.setAttribute("aria-label", "Dark mode");
      icon = document.createElement("span");
      icon.className = "prairie-darkmode-icon";
      icon.setAttribute("aria-hidden", "true");
      label = document.createElement("span");
      label.className = "prairie-darkmode-label";
      button.append(icon, label);
      button.addEventListener("click", () => {
        enabled = !enabled;
        revision += 1;
        render();
        // Keep this page usable even if the extension was reloaded/uninstalled.
        try {
          chrome.storage.local.set({ [STORAGE_KEY]: enabled }).catch(() => {});
        } catch {
          // A refreshed page reconnects to the extension after an update.
        }
      });
      render();
    }

    // Reuse the same button after HTMX/React replaces navigation or the body.
    if (button.parentElement !== container) container.append(button);
  }

  function scheduleMount() {
    if (queued) return;
    queued = true;
    queueMicrotask(mountToggle);
  }

  function rgb(color) {
    if (!/^rgba?\(/.test(color)) return null;
    const channels = color.match(/[\d.]+/g)?.map(Number);
    return channels?.length >= 3 ? channels : null;
  }

  function themeCourseContent() {
    courseFrame = 0;
    if (!enabled) return;
    const updates = [];
    for (const course of document.querySelectorAll(COURSE_SELECTOR)) {
      // Re-read authored colors after class/style changes, including transitions
      // from a neutral panel to colored feedback. Our markers aren't observed.
      for (const element of [course, ...course.querySelectorAll(`[${SURFACE_ATTRIBUTE}], [${TEXT_ATTRIBUTE}]`)]) {
        element.removeAttribute(SURFACE_ATTRIBUTE);
        element.removeAttribute(TEXT_ATTRIBUTE);
      }
      for (const element of [course, ...course.querySelectorAll("*")]) {
        if (element.closest(COURSE_EXCLUSIONS)) continue;
        const style = getComputedStyle(element);
        const background = rgb(style.backgroundColor);
        // Only replace neutral, opaque light panels, preserving colored feedback.
        if (background && (background[3] ?? 1) >= 0.85) {
          const channels = background.slice(0, 3);
          if (Math.min(...channels) >= 200 && Math.max(...channels) - Math.min(...channels) <= 32) {
            updates.push([element, SURFACE_ATTRIBUTE]);
          }
        }
        // Fix explicit navy/black text that cannot inherit the wrapper color.
        // Inspect text-bearing elements only, leaving figure pixels untouched.
        if (!Array.from(element.childNodes).some((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim())) continue;
        const color = rgb(style.color);
        if (!color || (color[3] ?? 1) === 0) continue;
        const linear = color.slice(0, 3).map((value) => {
          const channel = value / 255;
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
        const luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
        if (luminance < 0.12) updates.push([element, TEXT_ATTRIBUTE]);
      }
    }
    // Batch writes after style reads, and avoid changing course-authored styles.
    for (const [element, attribute] of updates) element.setAttribute(attribute, "");
  }

  function scheduleCourseTheme() {
    if (!enabled || courseFrame) return;
    courseFrame = requestAnimationFrame(themeCourseContent);
  }

  function affectsCourse(record) {
    if (record.target instanceof Element && (
      record.target.closest(COURSE_SELECTOR) || record.target.matches("style, link[rel='stylesheet']")
    )) return true;
    return Array.from(record.addedNodes).some((node) => node instanceof Element && (
      node.matches(COURSE_SELECTOR) || node.querySelector(COURSE_SELECTOR) || node.matches("style, link[rel='stylesheet']")
    ));
  }

  // Apply at document_start, before the first page paint whenever possible.
  render();

  // Register before reading so a change in another tab cannot be lost at startup.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !Object.hasOwn(changes, STORAGE_KEY)) return;
    revision += 1;
    const value = changes[STORAGE_KEY].newValue;
    enabled = typeof value === "boolean" ? value : true;
    render();
  });

  const readRevision = revision;
  chrome.storage.local.get(STORAGE_KEY).then((stored) => {
    // A slow startup read must not overwrite a newer click/storage event.
    if (revision !== readRevision) return;
    if (typeof stored[STORAGE_KEY] === "boolean") enabled = stored[STORAGE_KEY];
    render();
  }).catch(() => {
    // Default to dark when storage is temporarily unavailable.
  });

  const observer = new MutationObserver((records) => {
    if (records.some(affectsCourse)) scheduleCourseTheme();
    // Most mutations are clocks, math rendering, or question updates. Only
    // search again if the button is absent or navigation was replaced.
    if (button?.isConnected) return;
    if (records.some((record) => record.addedNodes.length || record.removedNodes.length)) {
      scheduleMount();
    }
  });
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
  // External course styles can finish loading after their markup is inserted.
  document.addEventListener("load", (event) => {
    if (event.target instanceof Element && event.target.matches("link[rel='stylesheet']")) scheduleCourseTheme();
  }, true);
  window.addEventListener("load", scheduleCourseTheme, { once: true });
  mountToggle();
})();
