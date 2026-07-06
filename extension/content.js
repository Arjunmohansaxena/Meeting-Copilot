let banner;

function showBanner() {
  if (banner) return;
  banner = document.createElement("div");
  banner.textContent = "🔴 Recording meeting for summary";
  banner.style.position = "fixed";
  banner.style.top = "10px";
  banner.style.left = "50%";
  banner.style.transform = "translateX(-50%)";
  banner.style.background = "#d32f2f";
  banner.style.color = "white";
  banner.style.padding = "8px 16px";
  banner.style.borderRadius = "6px";
  banner.style.fontFamily = "sans-serif";
  banner.style.fontSize = "14px";
  banner.style.zIndex = "999999";
  document.body.appendChild(banner);
}

function hideBanner() {
  if (banner) {
    banner.remove();
    banner = null;
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "show-banner") showBanner();
  if (msg.action === "hide-banner") hideBanner();
});
