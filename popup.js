document.querySelector("#open").addEventListener("click", async () => {
  await chrome.tabs.create({ url: chrome.runtime.getURL("app.html") });
  window.close();
});
