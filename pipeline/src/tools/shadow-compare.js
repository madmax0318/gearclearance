export function shadowCompare(heuristic, modeled) {
  const rows = [];
  const byUrl = new Map((modeled || []).map((item) => [item.source_url || item.url, item]));
  for (const item of heuristic || []) {
    const other = byUrl.get(item.source_url || item.url);
    rows.push({
      url: item.source_url || item.url || null,
      price_match: other ? other.price === item.price : false,
      title_match: other ? other.title === item.title : false,
    });
  }
  return { rows, modeled: (modeled || []).length, heuristic: (heuristic || []).length };
}
