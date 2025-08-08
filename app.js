const startBtn = document.getElementById("start-scan");
const readerEl = document.getElementById("reader");
const resultEl = document.getElementById("result");

let html5QrCode;

startBtn.addEventListener("click", async () => {
  resultEl.textContent = "";
  readerEl.style.display = "block";
  readerEl.style.minHeight = "260px"; // ensure visible area

  try {
    // Create instance once
    if (!html5QrCode) html5QrCode = new Html5Qrcode("reader");

    // Try starting rear camera directly (works better on iOS/Android)
    await html5QrCode.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: 250 },
      (qrText) => {
        resultEl.textContent = "QR Data: " + qrText;
        // Stop after first decode
        html5QrCode.stop().then(() => {
          html5QrCode.clear();
          readerEl.style.display = "none";
        });
      },
      (err) => {
        // decoding errors are noisy; don't spam UI
        // console.debug("scan miss:", err);
      }
    );
  } catch (e) {
    console.error(e);
    resultEl.style.color = "crimson";
    resultEl.textContent =
      "ไม่สามารถเปิดกล้องได้: " +
      (e?.message || e?.name || "ตรวจสอบสิทธิ์การใช้กล้อง");
  }
});
