import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createServer } from "vite";
import { resolve } from "node:path";
const dom = new JSDOM(
  '<!doctype html><html><body><div id="root"></div></body></html>',
  { url: "http://localhost:5173/" },
);
for (const key of [
  "window",
  "document",
  "location",
  "HTMLElement",
  "Element",
  "Node",
  "MutationObserver",
  "Event",
  "MouseEvent",
])
  Object.defineProperty(globalThis, key, {
    value: dom.window[key],
    configurable: true,
  });
Object.defineProperty(globalThis, "navigator", {
  value: dom.window.navigator,
  configurable: true,
});
class StubMediaStream {
  getTracks() {
    return [];
  }
}
Object.defineProperty(globalThis, "MediaStream", {
  value: StubMediaStream,
  configurable: true,
});
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  value: true,
  configurable: true,
});
process.env.VITE_API_URL = "http://127.0.0.1:8787";
const vite = await createServer({
  root: resolve("web"),
  server: { middlewareMode: true },
  appType: "custom",
});
try {
  const { default: App } = await vite.ssrLoadModule("/src/App.tsx");
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root"));
  await React.act(async () => root.render(React.createElement(App)));
  await React.act(async () => {});
  assert.match(document.body.textContent, /Welcome/);
  assert.match(document.body.textContent, /Без номера телефона/);
  const input = document.querySelector('input[placeholder="Отображаемое имя"]');
  assert.ok(input);
  await React.act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      dom.window.HTMLInputElement.prototype,
      "value",
    ).set;
    setter.call(input, "Test User");
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
  assert.equal(input.value, "Test User");
  const button = [...document.querySelectorAll("button")].find(
    (b) => b.textContent.trim() === "Продолжить",
  );
  assert.ok(button && !button.disabled);
  await React.act(async () => button.click());
  for (let n = 0; n < 30 && !document.body.textContent.includes("Чаты"); n++)
    await React.act(async () => new Promise((r) => setTimeout(r, 100)));
  assert.match(document.body.textContent, /Чаты/);
  assert.match(document.body.textContent, /Контакты/);
  assert.match(document.body.textContent, /Настройки/);
  const settings = [...document.querySelectorAll("nav button")].find((b) =>
    b.textContent.includes("Настройки"),
  );
  assert.ok(settings);
  await React.act(async () => settings.click());
  assert.match(document.body.textContent, /Устройства/);
  console.log(
    "PASS: onboarding, identity creation, mobile navigation and settings render in simulated DOM",
  );
  await React.act(async () => root.unmount());
} finally {
  await vite.close();
  dom.window.close();
}
