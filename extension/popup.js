const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const statusText = document.getElementById("statusText");
const backendUrlInput = document.getElementById("backendUrl");

const DEFAULT_BACKEND_URL = "http://127.0.0.1:8000/upload";

function setStatus(message) {
  statusText.textContent = message;
}

function setRecordingState(isRecording) {
  startBtn.disabled = isRecording;
  stopBtn.disabled = !isRecording;
}

async function loadSettings() {
  const data = await chrome.storage.local.get({ backendUrl: DEFAULT_BACKEND_URL });
  backendUrlInput.value = data.backendUrl || DEFAULT_BACKEND_URL;
}

async function saveBackendUrl(value) {
  await chrome.storage.local.set({ backendUrl: value });
}

startBtn.addEventListener("click", async () => {
  const backendUrl = backendUrlInput.value.trim() || DEFAULT_BACKEND_URL;
  if (!backendUrl) {
    setStatus("Enter a backend URL before starting.");
    return;
  }

  await saveBackendUrl(backendUrl);
  chrome.runtime.sendMessage({ action: "start-recording", backendUrl });
  setStatus("Starting recording...");
  setRecordingState(true);
});

stopBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "stop-recording" });
  setStatus("Stopping recording...");
  setRecordingState(false);
});

backendUrlInput.addEventListener("change", async () => {
  const value = backendUrlInput.value.trim();
  await saveBackendUrl(value);
  setStatus("Backend URL saved.");
});

chrome.runtime.onMessage.addListener((message) => {
  if (!message || !message.type) return;

  switch (message.type) {
    case "status-update":
      setStatus(message.text);
      break;
    case "recording-finished":
      setStatus(message.text);
      setRecordingState(false);
      break;
    case "recording-error":
      setStatus(message.text);
      setRecordingState(false);
      break;
    default:
      break;
  }
});

loadSettings();
