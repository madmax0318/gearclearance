const toggle = document.getElementById("nav-toggle");

if (toggle) {
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") toggle.checked = false;
  });

  document.querySelectorAll("#sidebar a").forEach((link) => {
    link.addEventListener("click", () => {
      toggle.checked = false;
    });
  });
}
