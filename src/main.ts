import { mount } from "svelte";
import App from "./App.svelte";

const root = document.getElementById("app");
if (!root) throw new Error("Missing #app");

if (window.top !== window.self) {
  document.body.textContent = "This page must not be embedded in another site. Open it directly.";
} else {
  mount(App, { target: root });
}
