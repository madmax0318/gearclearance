import { codedError } from "./log.js";
import { fetchHardened } from "./fetch-hardened.js";
import { assertDriveToken } from "./sources/gmail.js";

export async function uploadReviewDoc({ token, folderId, name, body, fetchImpl, account }) {
  if (account) await assertDriveToken({ fetchImpl, token, account });
  const url = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
  const boundary = "stash-boundary";
  const meta = JSON.stringify({ name, parents: [folderId], mimeType: "application/vnd.google-apps.document" });
  const payload = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${body}\r\n--${boundary}--`;
  const response = fetchImpl
    ? await fetchImpl(url, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": `multipart/related; boundary=${boundary}` },
        body: payload,
      })
    : await fetchHardened(url, {
        job: "drive",
        method: "POST",
        kind: "email",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": `multipart/related; boundary=${boundary}`,
        },
        body: payload,
      });
  if (!response?.ok) throw codedError(6, "drive");
  const data = typeof response.json === "function" ? await response.json() : JSON.parse(response.body);
  return { file_id: data.id, parent_id: folderId };
}
