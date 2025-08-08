const startBtn = document.getElementById("start-scan");
const readerEl = document.getElementById("reader");
const resultEl = document.getElementById("result");
const statusEl = document.getElementById("status");

// Result card elements
const cardEl = document.getElementById("resultCard");
const ticketNoEl = document.getElementById("ticketNo");
const drawDateEl = document.getElementById("drawDate");
const prizeTextEl = document.getElementById("prizeText");

let html5QrCode;

startBtn.addEventListener("click", async () => {
  clearUI();
  readerEl.style.display = "block";
  readerEl.style.minHeight = "260px";
  setStatus("กำลังเปิดกล้อง...");

  try {
    if (!html5QrCode) html5QrCode = new Html5Qrcode("reader");

    await html5QrCode.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: 260 },
      async (qrText) => {
        await stopScanner();

        // 1) show raw QR (debug)
        resultEl.style.display = "block";
        resultEl.textContent = "QR Data: " + qrText;

        // 2) extract 6-digit ticket
        const ticketNumber = extractSixDigitNumber(qrText);
        if (!ticketNumber) {
          setStatus("อ่านเลขสลากไม่สำเร็จ กรุณาลองใหม่");
          return;
        }
        setStatus("เลขสลากที่อ่านได้: " + ticketNumber);

        // 3) fetch results
        setStatus("กำลังดึงผลรางวัลงวดล่าสุด...");
        let data;
        try {
          data = await fetchLatestResultsWithFallbacks();
        } catch (e) {
          setStatus("ดึงผลรางวัลไม่สำเร็จ: " + (e?.message || e));
          return;
        }
        if (!data) {
          setStatus("ดึงผลรางวัลไม่สำเร็จ (API ทั้งหมดล้มเหลว)");
          return;
        }

        // 4) compute prize
        const result = determinePrize(ticketNumber, data.prizes);
        showResult(ticketNumber, data.date, result);
        setStatus(""); // clear status
      },
      () => {}
    );
  } catch (e) {
    console.error(e);
    setStatus("ไม่สามารถเปิดกล้องได้: " + (e?.message || e?.name || "ตรวจสอบสิทธิ์การใช้กล้อง"));
  }
});

function setStatus(msg) {
  statusEl.textContent = msg || "";
}

async function stopScanner() {
  try {
    await html5QrCode.stop();
    await html5QrCode.clear();
    readerEl.style.display = "none";
  } catch {}
}

function clearUI() {
  setStatus("");
  resultEl.textContent = "";
  resultEl.style.display = "none";
  prizeTextEl.textContent = "-";
  ticketNoEl.textContent = "-";
  drawDateEl.textContent = "-";
  prizeTextEl.style.color = "";
  cardEl.style.display = "none";
}

/** Pull 6 consecutive digits (Thai lottery ticket number) */
function extractSixDigitNumber(qrText) {
  const m = String(qrText).match(/(\d{6})(?!\d)/); // last 6-digit block
  return m ? m[1] : null;
}

/** Try multiple endpoints, with visible error messages */
async function fetchLatestResultsWithFallbacks() {
  // Primary
  const endpoints = [
    { name: "rayriffy", url: "https://lotto.api.rayriffy.com/latest", viaProxy: false },
    // Mirror via GitHub raw (CORS OK through a proxy)
    { name: "gh-raw", url: "https://raw.githubusercontent.com/rayriffy/thai-lotto-results/master/latest.json", viaProxy: true },
    // Generic proxy for anything else
    { name: "allorigins", url: "https://lotto.api.rayriffy.com/latest", viaProxy: "allorigins" },
  ];

  for (const ep of endpoints) {
    try {
      let res;
      if (ep.viaProxy === true) {
        // Cloudflare-hosted pass-through (public mirror)
        const proxied = "https://r.jina.ai/http/" + ep.url.replace(/^https?:\/\//, "");
        res = await fetch(proxied, { cache: "no-store" });
      } else if (ep.viaProxy === "allorigins") {
        const proxied = "https://api.allorigins.win/raw?url=" + encodeURIComponent(ep.url);
        res = await fetch(proxied, { cache: "no-store" });
      } else {
        res = await fetch(ep.url, { cache: "no-store", mode: "cors" });
      }

      if (!res.ok) {
        setStatus(`API ${ep.name} ตอบกลับ ${res.status}`);
        continue;
      }

      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        // Some proxies return text that is still JSON-like
        json = JSON.parse(text.replace(/^\uFEFF/, "")); // strip BOM if any
      }
      const normalized = normalizeResults(json);
      if (normalized?.date && normalized?.prizes) {
        return normalized;
      } else {
        setStatus(`API ${ep.name} รูปแบบข้อมูลไม่ตรง (ปรับ normalizer ได้)`);
      }
    } catch (e) {
      setStatus(`API ${ep.name} ล้มเหลว: ${e?.message || e}`);
      continue;
    }
  }
  return null;
}

/** Normalize various API payload shapes */
function normalizeResults(json) {
  // Expected rayriffy-style
  const r = json?.response || json;
  if (!r) return null;

  const date = r.date || r.drawDate || r?.result?.date;
  const p = r.prizes || r.result || r;
  if (!p) return null;

  const toArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);
  return {
    date,
    prizes: {
      first: p.first || p.prize1,
      nearbyFirst: p.nearbyFirst || p.adjacentFirst || p.adjacent || [],
      second: toArray(p.second || p.prize2),
      third: toArray(p.third || p.prize3),
      fourth: toArray(p.fourth || p.prize4),
      fifth: toArray(p.fifth || p.prize5),
      frontThree: toArray(p.frontThree || p.firstThree || p.front3),
      backThree: toArray(p.backThree || p.lastThree || p.back3),
      lastTwo: p.lastTwo || p.last2 || p.two || p["2digits"]
    }
  };
}

/** Prize logic */
function determinePrize(ticket, prizes) {
  const t = String(ticket);

  if (equal(t, prizes.first)) return "🎉 รางวัลที่ 1";
  if (arrHas(prizes.nearbyFirst, t)) return "🎉 ข้างเคียงรางวัลที่ 1";
  if (arrHas(prizes.second, t)) return "🎉 รางวัลที่ 2";
  if (arrHas(prizes.third, t)) return "🎉 รางวัลที่ 3";
  if (arrHas(prizes.fourth, t)) return "🎉 รางวัลที่ 4";
  if (arrHas(prizes.fifth, t)) return "🎉 รางวัลที่ 5";

  if (prefixInSet(t, prizes.frontThree)) return "✅ เลขหน้า 3 ตัว";
  if (suffixInSet(t, prizes.backThree)) return "✅ เลขท้าย 3 ตัว";
  if (suffixMatch(t, prizes.lastTwo)) return "✅ เลขท้าย 2 ตัว";

  return "เสียใจ ไม่ถูกรางวัล";
}

function equal(a, b) {
  if (!a || !b) return false;
  return String(a).trim() === String(b).trim();
}
function arrHas(arr, val) {
  if (!Array.isArray(arr)) return false;
  return arr.some(x => equal(x, val));
}
function prefixInSet(ticket, arr) {
  if (!Array.isArray(arr)) return false;
  const first3 = ticket.slice(0,3);
  return arr.some(x => String(x).trim() === first3);
}
function suffixInSet(ticket, arr) {
  if (!Array.isArray(arr)) return false;
  const last3 = ticket.slice(-3);
  return arr.some(x => String(x).trim() === last3);
}
function suffixMatch(ticket, two) {
  if (!two) return false;
  const last2 = ticket.slice(-2);
  return String(two).trim() === last2;
}

function showResult(ticket, date, prizeText) {
  ticketNoEl.textContent = ticket;
  drawDateEl.textContent = date || "-";
  prizeTextEl.textContent = prizeText;
  prizeTextEl.style.color = prizeText.includes("🎉") || prizeText.includes("✅") ? "green" : "crimson";
  cardEl.style.display = "block";
}

/* ---- Optional: paste QR for testing without camera ---- */
(function addPasteTester() {
  const tester = document.createElement("div");
  tester.style.maxWidth = "500px";
  tester.style.margin = "12px auto";
  tester.innerHTML = `
    <input id="qrInput" placeholder="วางสตริง QR ที่นี่" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:8px;">
    <button id="testBtn" style="margin-top:8px;background:#007BFF;color:#fff;padding:10px 14px;border:none;border-radius:8px;">ทดสอบผลรางวัลด้วยสตริงนี้</button>
  `;
  document.querySelector(".container").appendChild(tester);
  document.getElementById("testBtn").addEventListener("click", async () => {
    clearUI();
    const text = document.getElementById("qrInput").value || "";
    const ticketNumber = extractSixDigitNumber(text);
    if (!ticketNumber) return setStatus("สตริงนี้ไม่มีเลข 6 หลักท้าย");
    setStatus("เลขสลากที่อ่านได้: " + ticketNumber);
    setStatus("กำลังดึงผลรางวัลงวดล่าสุด...");
    const data = await fetchLatestResultsWithFallbacks();
    if (!data) return setStatus("ดึงผลรางวัลไม่สำเร็จ");
    const result = determinePrize(ticketNumber, data.prizes);
    showResult(ticketNumber, data.date, result);
    setStatus("");
  });
})();
