let recording = false;
let offscreenReady = null;

function waitForOffscreenReady() {
  return new Promise((resolve) => {
    const listener = (msg) => {
      if (msg.action === "offscreen-ready") {
        chrome.runtime.onMessage.removeListener(listener);
        resolve();
      }
    };
    chrome.runtime.onMessage.addListener(listener);
  });
}

async function setupOffscreenDocument() {
  try {
    // Prefer the dedicated API to check for an existing offscreen document
    if (chrome.offscreen && chrome.offscreen.hasDocument) {
      const has = await chrome.offscreen.hasDocument();
      if (has) return;
    }
  } catch (err) {
    // Non-fatal: fall through to create the document
    console.warn("offscreen.hasDocument() unavailable, will attempt create:", err);
  }

  offscreenReady = waitForOffscreenReady();
  try {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["USER_MEDIA"],
      justification: "Recording tab audio for meeting summary",
    });
    await offscreenReady;
  } catch (err) {
    console.error("Failed to create offscreen document:", err);
    throw err;
  }
}

function sendStatus(text) {
  chrome.runtime.sendMessage({ type: "status-update", text });
}

chrome.runtime.onMessage.addListener(async (msg) => {
  if (msg.action === "start-recording") {
    if (recording) {
      sendStatus("Recording is already active.");
      return;
    }

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs[0]) {
      sendStatus("No active tab found.");
      return;
    }

    try {
      let streamId;
      try {
        streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabs[0].id });
      } catch (err) {
        console.error("Failed to get media stream id", err);
        let message = "Could not start recording.";
        const errMsg = String(err && (err.message || err));
        if (errMsg.includes("active stream")) {
          message = "Cannot capture this tab: another stream is active. Stop other recording/sharing and try again.";
        } else if (errMsg.toLowerCase().includes("permission") || errMsg.toLowerCase().includes("denied")) {
          message = "Permission denied. Allow tab audio capture when prompted.";
        }
        sendStatus(message);
        return;
      }

      await setupOffscreenDocument();
      chrome.runtime.sendMessage({ action: "offscreen-start", streamId, backendUrl: msg.backendUrl });
      chrome.tabs.sendMessage(tabs[0].id, { action: "show-banner" });
      recording = true;
      sendStatus("Recording started.");
    } catch (error) {
      console.error("Failed to start recording", error);
      sendStatus("Could not start recording.");
    }
  }

  if (msg.action === "stop-recording") {
    chrome.runtime.sendMessage({ action: "offscreen-stop" });

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { action: "hide-banner" });
    }

    recording = false;
    sendStatus("Stopping recording...");
  }

  if (msg.type === "recording-finished") {
    recording = false;
    sendStatus(msg.text || "Recording finished.");
  }

  if (msg.type === "recording-error") {
    recording = false;
    sendStatus(msg.text || "Recording error occurred.");
  }
});
