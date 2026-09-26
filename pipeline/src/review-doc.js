export function renderReviewDoc(candidates) {
  const lines = ["Review", ""];
  candidates.forEach((candidate, index) => {
    const id = `C${String(index + 1).padStart(2, "0")}`;
    lines.push(`[ ] ${id} ${candidate.title || candidate.slug || "card"}`);
  });
  lines.push("");
  lines.push("[ ] SUBMIT");
  return lines.join("\n");
}
