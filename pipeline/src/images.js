import sharp from "sharp";
import { codedError } from "./log.js";

export const CDN_PREFIX = "https://dvjr4l3xblvos.cloudfront.net/products/";
export const IMAGE_CAP = 400 * 1024;

export function imageAllowed(url) {
  return String(url || "").startsWith(CDN_PREFIX);
}

export async function reencodeJpeg(input) {
  let quality = 82;
  let buf = await sharp(input, { failOn: "none" }).rotate().jpeg({ quality }).toBuffer();
  while (buf.length > IMAGE_CAP && quality > 40) {
    quality -= 8;
    buf = await sharp(input, { failOn: "none" }).rotate().jpeg({ quality }).toBuffer();
  }
  if (buf.length > IMAGE_CAP) throw codedError(3, "image-cap");
  return buf;
}
