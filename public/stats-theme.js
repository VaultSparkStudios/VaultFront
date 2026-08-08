(() => {
  const root = document.documentElement;
  const stored = localStorage.getItem("vaultfront.publicTheme");
  const initial = stored === "light" || stored === "dark" ? stored : "dark";
  root.dataset.theme = initial;
  const updatePressed = () => {
    document.querySelectorAll("[data-theme-choice]").forEach((button) => {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.themeChoice === root.dataset.theme),
      );
    });
  };
  window.addEventListener("DOMContentLoaded", () => {
    updatePressed();
    document.querySelectorAll("[data-theme-choice]").forEach((button) => {
      button.addEventListener("click", () => {
        const theme = button.dataset.themeChoice;
        if (theme !== "light" && theme !== "dark") return;
        root.dataset.theme = theme;
        localStorage.setItem("vaultfront.publicTheme", theme);
        updatePressed();
      });
    });
  });
})();
