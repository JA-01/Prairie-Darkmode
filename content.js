(() => {
  "use strict";

  // Extension storage is shared across both products and all their open tabs.
  const STORAGE_KEY = "prairieDarkModeEnabled";
  const ROOT_ATTRIBUTE = "data-prairie-darkmode";
  const BUTTON_ID = "prairie-darkmode-toggle";
  const root = document.documentElement;
  if (!root || root.hasAttribute(ROOT_ATTRIBUTE)) return;

  let enabled = true;
  let revision = 0;
  let queued = false;
  let button;
  let icon;
  let label;

  function render() {
    // Only "dark" activates theme rules; "light" restores the site's styles.
    root.setAttribute(ROOT_ATTRIBUTE, enabled ? "dark" : "light");
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
    // Most mutations are clocks, math rendering, or question updates. Only
    // search again if the button is absent or navigation was replaced.
    if (button?.isConnected) return;
    if (records.some((record) => record.addedNodes.length || record.removedNodes.length)) {
      scheduleMount();
    }
  });
  observer.observe(root, { childList: true, subtree: true });
  mountToggle();
})();
