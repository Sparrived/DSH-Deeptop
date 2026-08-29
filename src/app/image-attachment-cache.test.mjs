import assert from "node:assert/strict";
import test from "node:test";
import {
  IMAGE_ATTACHMENT_CACHE_MAX_CHARS,
  IMAGE_ATTACHMENT_CACHE_MAX_ENTRIES,
  ImageAttachmentCache,
} from "./image-attachment-cache.ts";

test("keeps the most recently accessed attachments within the entry bound", async () => {
  const cache = new ImageAttachmentCache();
  for (let index = 0; index < IMAGE_ATTACHMENT_CACHE_MAX_ENTRIES + 2; index += 1) {
    cache.set(`s1:${index}`, Promise.resolve(`data-${index}`), 10);
  }
  assert.equal(cache.size, IMAGE_ATTACHMENT_CACHE_MAX_ENTRIES);
  assert.equal(await cache.get("s1:0"), undefined);
  assert.equal(await cache.get(`s1:${IMAGE_ATTACHMENT_CACHE_MAX_ENTRIES + 1}`), `data-${IMAGE_ATTACHMENT_CACHE_MAX_ENTRIES + 1}`);
});

test("evicts large values by approximate character budget", () => {
  const cache = new ImageAttachmentCache();
  cache.set("s1:small", Promise.resolve("small"), IMAGE_ATTACHMENT_CACHE_MAX_CHARS - 10);
  cache.set("s1:large", Promise.resolve("large"), 20);
  assert.equal(cache.get("s1:small"), undefined);
  assert.notEqual(cache.get("s1:large"), undefined);
});

test("removes all attachments for a deleted session", () => {
  const cache = new ImageAttachmentCache();
  cache.set("s1:a", Promise.resolve("a"));
  cache.set("s2:a", Promise.resolve("b"));
  cache.removeSession("s1");
  assert.equal(cache.get("s1:a"), undefined);
  assert.notEqual(cache.get("s2:a"), undefined);
});
