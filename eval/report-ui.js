// Shared by executable and read-only reports. This script never calls the server.
// Loaded in the head so the stored theme applies before the first paint.
(() => {
  const key = "easy-quote-evaluation-theme";
  const system = window.matchMedia("(prefers-color-scheme: dark)");
  let preference;
  try { preference = localStorage.getItem(key); } catch { /* Storage can be disabled. */ }
  if (!["light", "dark"].includes(preference)) preference = null;

  function apply() {
    const theme = preference || (system.matches ? "dark" : "light");
    document.documentElement.dataset.theme = theme;
    const button = document.querySelector("#theme-toggle");
    if (button) {
      button.textContent = theme === "dark" ? "Light mode" : "Dark mode";
      button.setAttribute("aria-label", `Switch to ${theme === "dark" ? "light" : "dark"} theme`);
    }
  }
  apply();
  system.addEventListener("change", apply);
  window.addEventListener("storage", event => {
    if (event.key !== key && event.key !== null) return;
    preference = ["light", "dark"].includes(event.newValue) ? event.newValue : null;
    apply();
  });

  function revealHash() {
    let id;
    try { id = decodeURIComponent(location.hash.slice(1)); } catch { return; }
    if (!id) return;
    const target = document.getElementById(id);
    if (!target) return;
    for (let parent = target; parent; parent = parent.parentElement) {
      if (parent instanceof HTMLDetailsElement) parent.open = true;
    }
    target.scrollIntoView({ block: "start" });
    // A jump from a failure should move keyboard focus to its evidence, too.
    if (!target.hasAttribute("tabindex")) target.tabIndex = -1;
    target.focus({ preventScroll: true });
  }
  document.addEventListener("DOMContentLoaded", () => {
    apply();
    document.querySelector("#theme-toggle")?.addEventListener("click", () => {
      preference = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      try { localStorage.setItem(key, preference); } catch { /* Keep the choice for this page. */ }
      apply();
    });
    document.addEventListener("click", event => {
      const link = event.target.closest?.('a[href^="#"]');
      if (link && link.hash === location.hash) revealHash();
    });
    revealHash();
  });
  window.addEventListener("hashchange", revealHash);
})();
