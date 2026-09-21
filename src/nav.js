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

const tagFilters = document.querySelector(".tag-filters");
const filterGrid = document.querySelector('.deal-grid[data-filterable="true"]');

if (tagFilters && filterGrid) {
  const countEl = document.querySelector(".result-count");
  const cards = [...filterGrid.querySelectorAll(".card")];
  const chips = [...tagFilters.querySelectorAll(".tag-chip")];

  function applyTag(tag) {
    let shown = 0;
    for (const card of cards) {
      const tags = (card.dataset.tags || "").split(/\s+/).filter(Boolean);
      const match = !tag || tags.includes(tag);
      card.hidden = !match;
      if (match) shown += 1;
    }
    for (const chip of chips) {
      const on = (chip.dataset.tag || "") === tag;
      chip.classList.toggle("is-on", on);
      chip.setAttribute("aria-pressed", on ? "true" : "false");
    }
    if (countEl) {
      const noun = shown === 1 ? "deal" : "deals";
      const label = chips
        .find((chip) => (chip.dataset.tag || "") === tag)
        ?.querySelector(".tag-chip-label")
        ?.textContent;
      countEl.textContent = tag ? `${shown} ${noun} · ${label}` : `${shown} ${noun} · newest first`;
    }
    filterGrid.hidden = shown === 0;
    let empty = filterGrid.parentElement.querySelector(".filter-empty");
    if (shown === 0) {
      if (!empty) {
        empty = document.createElement("p");
        empty.className = "empty filter-empty";
        empty.textContent = "No sample deals with that tag on this board.";
        filterGrid.after(empty);
      }
    } else if (empty) {
      empty.remove();
    }
  }

  tagFilters.addEventListener("click", (event) => {
    const chip = event.target.closest(".tag-chip");
    if (!chip || !tagFilters.contains(chip)) return;
    const tag = chip.dataset.tag || "";
    const url = new URL(window.location.href);
    if (tag) url.searchParams.set("tag", tag);
    else url.searchParams.delete("tag");
    window.history.replaceState(null, "", url);
    applyTag(tag);
  });

  const requested = new URL(window.location.href).searchParams.get("tag") || "";
  const known = chips.some((chip) => chip.dataset.tag === requested);
  applyTag(known ? requested : "");
}
