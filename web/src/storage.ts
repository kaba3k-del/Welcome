import { openDB } from "idb";
import type { Event } from "../../shared/protocol";
const db = openDB("welcome-v1", 1, {
  upgrade(d) {
    d.createObjectStore("kv");
    const s = d.createObjectStore("events", { keyPath: "id" });
    s.createIndex("chat", "chat");
  },
});
export const store = {
  async get<T>(key: string): Promise<T | undefined> {
    return (await db).get("kv", key);
  },
  async set(key: string, value: unknown) {
    return (await db).put("kv", value, key);
  },
  async events() {
    return (await db).getAll("events") as Promise<Event[]>;
  },
  async put(e: Event) {
    return (await db).put("events", e);
  },
  async purgeExpired() {
    const d = await db;
    const events = (await d.getAll("events")) as Event[];
    const expired = new Set(
      events
        .filter((e) => e.expires && e.expires < Date.now())
        .map((e) => e.id),
    );
    if (!expired.size) return;
    const tx = d.transaction("events", "readwrite");
    for (const e of events)
      if (expired.has(e.id) || (e.target && expired.has(e.target)))
        await tx.store.delete(e.id);
    await tx.done;
  },
  async clearHistory() {
    return (await db).clear("events");
  },
};
