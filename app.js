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
  statusEl.textContent = "กำลังเปิดกล้อง...";

  try {
    if (!html5QrCode) html5QrCode = new Html5Qrcode("reader");

    await html5QrCode.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: 260 },
      async (qrText) => {
        // Show raw for debug if you want
        resultEl.style.display = "block";
        resultEl.textContent = "QR Data: " + qrText;

        await stopScanner();

        const ticketNumber = extractSixDigitNumber(qrText);
        if (!ticketNumber) {
          setStatus("อ่านเลขสลากไม่สำเร็จ กรุณาลองใหม่");
          return;
        }

        setStatus("กำลังดึงผลรางวัลงวดล่าสุด...");
        const data = await fetchLatestResults();
        if (!data) {
          setStatus("ดึงผลรางวัลไม่สำเร็จ ลองใหม่อีกครั้ง");
          return;
        }

        // Compute prize
        const result = determinePrize(ticketNumber, data.prizes);
        showResult(ticketNumber, data.date, result);
        setStatus("");
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
  cardEl.style.display = "none";
}

/** Try to pull 6 consecutive digits from the QR payload */
function extractSixDigitNumber(qrText) {
  // Many Thai lottery QR formats contain groups; we just need the 6-digit ticket number.
  const m = qrText.match(/(\d{6})/);
  return m ? m[1] : null;
}

/** Fetch latest draw JSON (community API). Swap endpoint if needed. */
async function fetchLatestResults() {
  const endpoints = [
    // Primary (community)
    "https://lotto.api.rayriffy.com/latest",
    // Add backups here if you have any others:
    // "https://thai-lottery-api.vercel.app/api/latest"
  ];

  for (const url of endpoints) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) continue;
      const json = await res.json();

      // Normalize possible shapes into { date, prizes: {...} }
      const payload = normalizeResults(json);
      if (payload?.date && payload?.prizes) return payload;
    } catch (e) {
      // try next endpoint
    }
  }
  return null;
}

/** Accepts various API shapes and returns a normalized structure */
function normalizeResults(json) {
  // Expected Rayriffy-ish shape
  // {
  //   response: {
  //     date: "YYYY-MM-DD",
  //     prizes: {
  //       first: "123456",
  //       nearbyFirst: ["123455","123457"],
  //       second: [..5 numbers..],
  //       third: [...],
  //       fourth: [...],
  //       fifth: [...],
  //       frontThree: ["123","456"],
  //       backThree: ["123","456"],
  //       lastTwo: "12"
  //     }
  //   }
  // }
  const r = json?.response || json;
  if (!r) return null;

  const date = r.date || r.drawDate || r?.result?.date;
  const p = r.prizes || r.result || r;
  if (!p) return null;

  return {
    date,
    prizes: {
      first: p.first || p.prize1,
      nearbyFirst: p.nearbyFirst || p.adjacentFirst || p.adjacent || [],
      second: p.second || p.prize2 || [],
      third: p.third || p.prize3 || [],
      fourth: p.fourth || p.prize4 || [],
      fifth: p.fifth || p.prize5 || [],
      frontThree: p.frontThree || p.firstThree || p.front3 || [],
      backThree: p.backThree || p.lastThree || p.back3 || [],
      lastTwo: p.lastTwo || p.last2 || p.two || p["2digits"]
    }
  };
}

/** Determine prize label for a 6-digit ticket number */
function determinePrize(ticket, prizes) {
  const t = String(ticket);

  if (equal(t, prizes.first)) return "🎉 รางวัลที่ 1";
  if (arrHas(prizes.nearbyFirst, t)) return "🎉 ข้างเคียงรางวัลที่ 1";
  if (arrHas(prizes.second, t)) return "🎉 รางวัลที่ 2";
  if (arrHas(prizes.third, t)) return "🎉 รางวัลที่ 3";
  if (arrHas(prizes.fourth, t)) return "🎉 รางวัลที่ 4";
  if (arrHas(prizes.fifth, t)) return "🎉 รางวัลที่ 5";

  // front 3 and back 3
  if (prefixInSet(t, prizes.frontThree)) return "✅ เลขหน้า 3 ตัว";
  if (suffixInSet(t, prizes.backThree)) return "✅ เลขท้าย 3 ตัว";

  // last two digits
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
