let recorder;
let chunks = [];
let audioContext;
let speakerOutput;

function sendMessage(message) {
  chrome.runtime.sendMessage(message);
}

chrome.runtime.sendMessage({ action: "offscreen-ready" });

async function uploadRecording(blob, backendUrl) {
  if (!backendUrl) {
    return { success: false, error: "No backend URL provided" };
  }

  try {
    const formData = new FormData();
    formData.append("file", blob, "meeting-recording.webm");

    const response = await fetch(backendUrl, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: `Upload failed (${response.status}): ${text}` };
    }

    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message || String(error) };
  }
}

function stopStreams(tabStream, micStream) {
  tabStream.getTracks().forEach((t) => t.stop());
  micStream.getTracks().forEach((t) => t.stop());
  if (audioContext) {
    audioContext.close().catch(() => {});
    audioContext = null;
  }
  if (speakerOutput) {
    speakerOutput.pause();
    speakerOutput.srcObject = null;
    speakerOutput = null;
  }
}

chrome.runtime.onMessage.addListener(async (msg) => {
  if (msg.action === "offscreen-start") {
    try {
      const tabStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          mandatory: {
            chromeMediaSource: "tab",
            chromeMediaSourceId: msg.streamId,
          },
        },
      });

      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true },
      });

      audioContext = new AudioContext();
      const destination = audioContext.createMediaStreamDestination();

      audioContext.createMediaStreamSource(tabStream).connect(destination);
      audioContext.createMediaStreamSource(micStream).connect(destination);

      speakerOutput = new Audio();
      speakerOutput.srcObject = tabStream;
      await speakerOutput.play().catch(() => {
        // Autoplay may be blocked. Recording should still work.
      });

      const mixedStream = destination.stream;
      recorder = new MediaRecorder(mixedStream);
      chunks = [];

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: "audio/webm" });
        stopStreams(tabStream, micStream);

        if (msg.backendUrl) {
          const uploadResult = await uploadRecording(blob, msg.backendUrl);
          if (uploadResult.success) {
            // If backend returned a PDF (base64), download it automatically
            try {
              const data = uploadResult.data || {};
              if (data.pdf_base64) {
                const pdfBytes = atob(data.pdf_base64);
                const len = pdfBytes.length;
                const u8 = new Uint8Array(len);
                for (let i = 0; i < len; i++) u8[i] = pdfBytes.charCodeAt(i);
                const pdfBlob = new Blob([u8], { type: "application/pdf" });
                const pdfUrl = URL.createObjectURL(pdfBlob);
                const pdfName = data.pdf_name || `meeting_report_${Date.now()}.pdf`;
                const a = document.createElement("a");
                a.href = pdfUrl;
                a.download = pdfName;
                a.click();
                URL.revokeObjectURL(pdfUrl);
              }
            } catch (err) {
              console.warn("Failed to download PDF", err);
            }

            sendMessage({
              type: "recording-finished",
              text: "Recording uploaded successfully.",
              report: uploadResult.data,
            });
            return;
          }

          sendMessage({
            type: "recording-error",
            text: `Upload failed: ${uploadResult.error}`,
          });
        }

        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "meeting-recording.webm";
        a.click();
        sendMessage({ type: "recording-finished", text: "Recording downloaded locally." });
      };

      recorder.start();
      sendMessage({ type: "status-update", text: "Recording active." });
    } catch (error) {
      console.error("Offscreen recording failed", error);
      let text = "Could not start recording.";
      if (error && error.name === "NotAllowedError") {
        text = "Permission dismissed. Please allow audio capture when prompted for this tab.";
      } else if (error && error.message && error.message.includes("Cannot capture a tab with an active stream")) {
        text = "Cannot capture this tab: another stream is active. Stop other recording/sharing in this tab and try again.";
      } else if (error && error.message && error.message.toLowerCase().includes("permission")) {
        text = "Permission denied. Allow audio capture when prompted.";
      }
      sendMessage({ type: "recording-error", text });
    }
  }

  if (msg.action === "offscreen-stop") {
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
  }
});
