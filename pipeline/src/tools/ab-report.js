export function abReport(left, right) {
  const leftIds = new Set((left || []).map((item) => item.slug || item.url));
  const rightIds = new Set((right || []).map((item) => item.slug || item.url));
  const onlyLeft = [...leftIds].filter((id) => !rightIds.has(id));
  const onlyRight = [...rightIds].filter((id) => !leftIds.has(id));
  return {
    left: leftIds.size,
    right: rightIds.size,
    only_left: onlyLeft,
    only_right: onlyRight,
    agreement: onlyLeft.length === 0 && onlyRight.length === 0,
  };
}
