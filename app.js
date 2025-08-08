// ---------- DOM refs ----------
const startBtn = document.getElementById("start-scan");
const readerEl = document.getElementById("reader");
const resultEl = document.getElementById("result");        // raw QR (debug)
const statusEl = document.getElementById("status");        // small status line

// Result card (must exist in index.html)
const cardEl = document.getElementById("resultCard");
const ticketNoEl = document.getElementById("ticketNo");
const drawDateEl = document.getElementById("drawDate");
const prizeTextEl = document.getElementById("prizeText");

// Date picker (created on the fly if not present)
let datePicker = document.getElementById("datePicker");
let drawDateInput = document.getElementById("drawDateInput");
let checkByDateBtn = document.getElementById("checkByDateBtn");
ensureDatePicker();

// QR instance
let html5QrCode = null;

// ---------- UI wiring ----------
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

        // Show raw QR for debugging
        resultEl.style.display = "block";
        resultEl.textContent = "QR Data: " + qrText;

        // 1) Extract ticket number (6 digits)
        const ticketNumber = extractSixDigitNumber(qrText);
        if (!ticketNumber) {
          setStatus("อ่านเลขสลากไม่สำเร็จ กรุณาลองใหม่");
          return;
        }
        setStatus("เลขสลากที่อ่านได้: " + ticketNumber);

        // 2) Try to auto-detect draw date from QR
        let isoDate = extractDrawDate(qrText);
        if (isoDate) {
          setStatus(`พบบ่งชี้งวด: ${isoDate} กำลังดึงผล...`);
          const data = await fetchResultsByDate(isoDate);
          if (data) {
            const result = determinePrize(ticketNumber, data.prizes);
            showResult(ticketNumber, data.date, result);
            setStatus("");
            return;
          } else {
            setStatus("ดึงผลตามวันที่จาก QR ไม่สำเร็จ");
          }
        }

        // 3) Fallback: manual date picker
        datePicker.style.display = "block";
        drawDateInput.value = guessRecentDrawIso();
        setStatus("กำหนด 'งวดวันที่' แล้วกด 'ตรวจผลตามวันที่นี้'");
        checkByDateBtn.onclick = async () => {
          const chosen = drawDateInput.value;
          if (!chosen) return setStatus("กรุณาเลือกวันที่งวด");
          setStatus(`กำลังดึงผลงวด ${chosen}...`);
          const data = await fetchResultsByDate(chosen);
          if (!data) return setStatus("ไม่พบผลรางวัลงวดนี้");
          const result = determinePrize(ticketNumber, data.prizes);
          showResult(ticketNumber, data.date, result);
          setStatus("");
        };
      },
      () => {} // decode failures ignored
    );
  } catch (e) {
    console.error(e);
    setStatus("ไม่สามารถเปิดกล้องได้: " + (e?.message || e?.name || "ตรวจสอบสิทธิ์การใช้กล้อง"));
  }
});

// ---------- UI helpers ----------
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
  if (datePicker) datePicker.style.display = "none";
}

function ensureDatePicker() {
  if (!datePicker) {
    const wrapper = document.createElement("div");
    wrapper.id = "datePicker";
    wrapper.style.display = "none";
    wrapper.style.maxWidth = "500px";
    wrapper.style.margin = "12px auto";
    wrapper.innerHTML = `
      <label for="drawDateInput" style="display:block; margin-bottom:6px;">
        เลือกงวดวันที่ (ถ้าระบุอัตโนมัติไม่สำเร็จ)
      </label>
      <input id="drawDateInput" type="date" style="width:100%; padding:10px; border:1px solid #ddd; border-radius:8px;">
      <button id="checkByDateBtn" style="margin-top:8px; background:#007BFF; color:#fff; padding:10px 14px; border:none; border-radius:8px;">
        ตรวจผลตามวันที่นี้
      </button>
    `;
    document.querySelector(".container")?.appendChild(wrapper);
    datePicker = wrapper;
    drawDateInput = document.getElementById("drawDateInput");
    checkByDateBtn = document.getElementById("checkByDateBtn");
  }
}

// ---------- Parsing ----------
/**
 * Thai lottery QR is commonly: aa-bb-cc-dddddd-eeee
 * where the 4th chunk (dddddd) is the 6-digit ticket number.
 * We grab that first. Fallbacks handle slightly different shapes.
 */
function extractSixDigitNumber(qrText) {
  const s = String(qrText).trim();

  // Exact pattern
  const m = s.match(/^(\d{2})-(\d{2})-(\d{2})-(\d{6})-(\d{4})$/);
  if (m) return m[4];

  // Generic hyphen split: the 4th chunk if 6 digits
  const parts = s.split("-");
  if (parts.length >= 4 && /^\d{6}$/.test(parts[3])) return parts[3];

  // Fallback: choose the 6‑digit group that is NOT the final 4-digit group
  const groups = s.match(/\d{6}/g) || [];
  if (groups.length >= 2) return groups[groups.length - 2]; // second last 6-digit group
  if (groups.length === 1) return groups[0];

  return null;
}

/**
 * Try to derive draw date (YYYY-MM-DD) from aa-bb-cc groups.
 * We test a few permutations and keep only plausible Thai draw days (1,2,3,16,17).
 * Once you share sample QR strings + known draw dates, we can lock the exact mapping.
 */
function extractDrawDate(qrText) {
  const s = String(qrText).trim();
  const m = s.match(/^(\d{2})-(\d{2})-(\d{2})-(\d{6})-(\d{4})$/);
  if (!m) return null;

  const [, g1, g2, g3] = m;

  // Candidates: yy-mm-dd, dd-mm-yy, yy-dd-mm
  const candidates = [
    yyMmDdToIso(g1, g2, g3),
    yyMmDdToIso(g3, g2, g1),
    yyMmDdToIso(g1, g3, g2),
  ].filter(Boolean);

  // Keep plausible Thai draw days
  const plausible = candidates.find(d => isPlausibleThaiDrawDate(d));
  return plausible || null;
}

// Convert 2-digit year/month/day to ISO (assume 20YY; adjust if we find BE later)
function yyMmDdToIso(yy, mm, dd) {
  const y = Number(yy), m = Number(mm), d = Number(dd);
  if (!(y>=0 && y<=99 && m>=1 && m<=12 && d>=1 && d<=31)) return null;
  const year = 2000 + y;
  const iso = `${year}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

function isPlausibleThaiDrawDate(iso) {
  const d = new Date(iso + "T00:00:00Z");
  const day = d.getUTCDate();
  // Main draws 1 & 16; sometimes shifted to 2,3,17 due to holidays
  return [1,2,3,16,17].includes(day);
}

// Suggest recent draw (for the manual picker)
function guessRecentDrawIso() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth(); // 0..11
  const day = now.getDate();
  // If past 16th, suggest 16; otherwise 1st (UTC to avoid TZ drift)
  const pick = (day >= 16) ? 16 : 1;
  const d = new Date(Date.UTC(y, m, pick));
  return d.toISOString().slice(0,10);
}

// ---------- Fetch results ----------
async function fetchResultsByDate(isoDate) {
  // Try multiple sources; normalize afterward
  const endpoints = [
    { name: "rayriffy", url: `https://lotto.api.rayriffy.com/draw/${isoDate}`, kind: "json" },
    { name: "gh-raw",   url: `https://raw.githubusercontent.com/rayriffy/thai-lotto-results/master/${isoDate}.json`, kind: "proxy" },
    { name: "fallback", url: `https://api.allorigins.win/raw?url=${encodeURIComponent('https://lotto.api.rayriffy.com/draw/' + isoDate)}`, kind: "raw" },
  ];

  for (const ep of endpoints) {
    try {
      let res;
      if (ep.kind === "proxy") {
        // Simple CORS passthrough
        const proxied = "https://r.jina.ai/http/" + ep.url.replace(/^https?:\/\//, "");
        res = await fetch(proxied, { cache: "no-store" });
      } else {
        res = await fetch(ep.url, { cache: "no-store" });
      }

      if (!res.ok) {
        setStatus(`API ${ep.name} ตอบกลับ ${res.status}`);
        continue;
      }

      const text = await res.text();
      let json;
      try { json = JSON.parse(text); }
      catch { json = JSON.parse(text.replace(/^\uFEFF/, "")); } // strip BOM if any

      const normalized = normalizeResults(json);
      if (normalized?.date && normalized?.prizes) return normalized;

      setStatus(`API ${ep.name} รูปแบบข้อมูลไม่ตรง`);
    } catch (e) {
      setStatus(`API ${ep.name} ล้มเหลว: ${e?.message || e}`);
      continue;
    }
  }
  return null;
}

// Rayriffy-style normalization (with a few aliases)
function normalizeResults(json) {
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

// ---------- Prize logic ----------
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

// ---------- Optional: paste QR to test without camera ----------
;(function addPasteTester() {
  const tester = document.createElement("div");
  tester.style.maxWidth = "500px";
  tester.style.margin = "12px auto";
  tester.innerHTML = `
    <input id="qrInput" placeholder="วางสตริง QR ที่นี่ (สำหรับทดสอบ)" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:8px;">
    <button id="testBtn" style="margin-top:8px;background:#007BFF;color:#fff;padding:10px 14px;border:none;border-radius:8px;">ทดสอบผลรางวัลจากสตริงนี้</button>
  `;
  document.querySelector(".container")?.appendChild(tester);
  document.getElementById("testBtn").addEventListener("click", async () => {
    clearUI();
    const text = document.getElementById("qrInput").value || "";
    resultEl.style.display = "block";
    resultEl.textContent = "QR Data: " + text;

    const ticketNumber = extractSixDigitNumber(text);
    if (!ticketNumber) return setStatus("สตริงนี้ไม่มีเลข 6 หลักตามรูปแบบสลาก");
    setStatus("เลขสลากที่อ่านได้: " + ticketNumber);

    // Try auto date, then manual
    let isoDate = extractDrawDate(text);
    if (isoDate) {
      setStatus(`พบบ่งชี้งวด: ${isoDate} กำลังดึงผล...`);
      const data = await fetchResultsByDate(isoDate);
      if (data) {
        const result = determinePrize(ticketNumber, data.prizes);
        showResult(ticketNumber, data.date, result);
        setStatus("");
        return;
      }
    }
    datePicker.style.display = "block";
    drawDateInput.value = guessRecentDrawIso();
    setStatus("ระบุวันที่งวด แล้วกดตรวจผล");
    checkByDateBtn.onclick = async () => {
      const chosen = drawDateInput.value;
      if (!chosen) return setStatus("กรุณาเลือกวันที่งวด");
      setStatus(`กำลังดึงผลงวด ${chosen}...`);
      const data = await fetchResultsByDate(chosen);
      if (!data) return setStatus("ไม่พบผลรางวัลงวดนี้");
      const result = determinePrize(ticketNumber, data.prizes);
      showResult(ticketNumber, data.date, result);
      setStatus("");
    };
  });
})();

// ---------- Show result on card ----------
function showResult(ticket, date, prizeText) {
  ticketNoEl.textContent = ticket;
  drawDateEl.textContent = date || "-";
  prizeTextEl.textContent = prizeText;
  prizeTextEl.style.color = prizeText.includes("🎉") || prizeText.includes("✅") ? "green" : "crimson";
  cardEl.style.display = "block";
}
