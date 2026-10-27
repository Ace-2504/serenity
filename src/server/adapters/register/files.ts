import type { UploadedFile } from "@/server/ingest/parse";

export const MAX_REGISTER_FILES = 8;
export const MAX_REGISTER_BYTES = 50 * 1024 * 1024;
export const REGISTER_SOURCE_NAME = "Spreadsheet registers (BUSY or other)";

/** Files from a multipart form, or an error message. */
export async function registerFiles(form: FormData): Promise<UploadedFile[] | string> {
  const uploads = form.getAll("files").filter((f): f is File => typeof f === "object" && "arrayBuffer" in f);
  if (uploads.length === 0) return "Choose the register files (Excel or CSV)";
  if (uploads.length > MAX_REGISTER_FILES) return `Upload at most ${MAX_REGISTER_FILES} registers at once`;
  if (uploads.reduce((s, f) => s + f.size, 0) > MAX_REGISTER_BYTES) return "The upload is larger than 50 MB";
  if (uploads.some((f) => !/\.(xlsx|csv|txt)$/i.test(f.name))) return "Registers must be .xlsx or .csv files (save .xls files as .xlsx first)";
  return Promise.all(uploads.map(async (f) => ({ name: f.name, content: Buffer.from(await f.arrayBuffer()) })));
}
