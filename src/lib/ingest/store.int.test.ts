// Uploaded files live in Postgres (npm run test:int). Uses a throw-away key and removes it afterwards.
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "@/lib/db/client";
import { deleteFile, loadFile, saveFile } from "./store";

const keys: string[] = [];
afterAll(async () => { for (const k of keys) await deleteFile(k); await pool.end(); });

describe("upload storage in the database", () => {
  it("saves a file and returns the same bytes, including non-text bytes", async () => {
    const data = Buffer.from([0, 1, 2, 250, 255, 10, 13, 65]);
    const key = await saveFile("store-test", "My file (1).csv", data);
    keys.push(key);
    expect(key).toBe("store-test-My_file__1_.csv");
    expect((await loadFile(key)).equals(data)).toBe(true);
  });
  it("saving the same key again replaces the file", async () => {
    const key = await saveFile("store-test", "again.csv", Buffer.from("one"));
    keys.push(key);
    await saveFile("store-test", "again.csv", Buffer.from("two"));
    expect((await loadFile(key)).toString()).toBe("two");
  });
  it("deletes once, then reports it was already gone, and refuses to read it", async () => {
    const key = await saveFile("store-test", "gone.csv", Buffer.from("x"));
    expect(await deleteFile(key)).toBe(true);
    expect(await deleteFile(key)).toBe(false);
    await expect(loadFile(key)).rejects.toThrow(/no longer stored/);
  });
  it("refuses keys that try to leave the storage area", async () => {
    await expect(loadFile("../secret")).rejects.toThrow(/Bad storage key/);
    expect(await deleteFile("a/b")).toBe(false);
  });
});
