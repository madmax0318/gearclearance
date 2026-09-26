import { resolveCategory } from "../category-policy.js";
import { candidatesFromAimHtml, collectAim } from "../sources/aimsurplus.js";
import { imageAllowed, reencodeJpeg } from "../images.js";
import { fetchHardened } from "../fetch-hardened.js";

export { candidatesFromAimHtml };

export async function runAim(options = {}) {
  const collected = await collectAim(options);
  const candidates = [];
  for (const candidate of collected.candidates) {
    if (candidate.price_source !== "json-ld") continue;
    const category = resolveCategory(candidate);
    if (!category.ok) continue;
    let image = null;
    if (candidate.image && imageAllowed(candidate.image)) {
      const response = options.fetchImpl
        ? await options.fetchImpl(candidate.image)
        : await fetchHardened(candidate.image, { job: "aim", kind: "page" });
      if (response?.ok && response.body) image = await reencodeJpeg(Buffer.from(response.body));
    }
    candidates.push({
      slug: `aim-item-${candidates.length + 1}`,
      title: candidate.title,
      url: category.url,
      category: category.category,
      price_now: candidate.price,
      image_bytes: image ? image.length : 0,
    });
  }
  return { candidates, dropped: collected.dropped };
}
