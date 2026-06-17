import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

// The dump-box data path. Clients upload directly to Supabase (RLS-gated): raw bytes to the
// 'uploads' bucket + a raw_uploads row (status 'pending') for the M5 worker to normalize.
// Pure helpers here are unit-tested; the IO functions are integration-tested vs real Supabase.

export type UploadKind = Database["public"]["Tables"]["raw_uploads"]["Row"]["kind"];

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "tiff"]);
const TEXT_KINDS = new Set<UploadKind>(["text", "md"]);

/** Classify an upload by filename + mime. Pure. */
export function fileKind(name: string, mime?: string): UploadKind {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "md" || ext === "markdown") return "md";
  if (ext === "txt") return "text";
  if (ext === "pdf" || mime === "application/pdf") return "pdf";
  if ((mime ?? "").startsWith("image/") || IMAGE_EXT.has(ext)) return "image";
  return "other";
}

/** Storage object name within a contributor's folder (RLS requires the uid as folder[1]). */
export function storagePath(uid: string, fileName: string): string {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]+/g, "_");
  return `${uid}/${crypto.randomUUID()}-${safe}`;
}

export interface DumpResult {
  id: string;
}

type Client = SupabaseClient<Database>;

/** Upload one file: bytes -> Storage, then a pending raw_uploads row (text kinds inline raw_text). The
 *  graph_id travels with the row so the normalize worker writes into the right graph regardless of who
 *  is active when the cron drains it. */
export async function uploadFile(supabase: Client, uid: string, graphId: string, file: File): Promise<DumpResult> {
  const kind = fileKind(file.name, file.type);
  const path = storagePath(uid, file.name);

  const up = await supabase.storage.from("uploads").upload(path, file, { upsert: false });
  if (up.error) throw new Error(`storage upload failed: ${up.error.message}`);

  const raw_text = TEXT_KINDS.has(kind) ? await file.text() : null;
  const ins = await supabase
    .from("raw_uploads")
    .insert({ contributor: uid, graph_id: graphId, kind, storage_path: path, raw_text })
    .select("id")
    .single();
  if (ins.error) throw new Error(`raw_uploads insert failed: ${ins.error.message}`);
  return { id: ins.data.id };
}

/** Insert a pasted-text dump (no Storage object). */
export async function uploadText(supabase: Client, uid: string, graphId: string, text: string): Promise<DumpResult> {
  const ins = await supabase
    .from("raw_uploads")
    .insert({ contributor: uid, graph_id: graphId, kind: "text", raw_text: text })
    .select("id")
    .single();
  if (ins.error) throw new Error(`raw_uploads insert failed: ${ins.error.message}`);
  return { id: ins.data.id };
}
