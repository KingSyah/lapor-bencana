/* ═══════════════════════════════════════════
   LAPOR BENCANA — app.js
   ═══════════════════════════════════════════ */

/* ── Config: Supabase ── */
const SUPABASE_URL  = 'https://lfjajcxotlypisupiedi.supabase.co';
const SUPABASE_ANON = 'sb_publishable_1bSLL_4J0acZA19IwYYnLw_q8DX0c5b';

let telegramToken  = null;
let telegramChatId = null;

/* ═══════════════════════════════════════════
   MAP — Leaflet
   ═══════════════════════════════════════════ */
const LANGSA = [4.4700, 97.9400];

const map = L.map('map', { zoomControl: false }).setView(LANGSA, 13);
L.control.zoom({ position: 'bottomright' }).addTo(map);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  maxZoom: 19,
}).addTo(map);

const marker = L.marker(LANGSA, {
  draggable: true,
  icon: L.divIcon({
    className: '',
    html: '<div style="font-size:1.8rem;text-align:center;line-height:1">📌</div>',
    iconSize: [30, 36],
    iconAnchor: [15, 36],
  }),
}).addTo(map);

marker.on('dragend', updateCoordBadge);
updateCoordBadge();

/** Return current marker lat/lng */
function getCoords() {
  return marker.getLatLng();
}

/** Update coordinate badge text */
function updateCoordBadge() {
  const { lat, lng } = getCoords();
  document.getElementById('coordBadge').textContent =
    `Koordinat: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

/** Reset map view & marker to default */
function resetMap() {
  map.setView(LANGSA, 13);
  marker.setLatLng(LANGSA);
  updateCoordBadge();
}

/** Use browser GPS to position marker */
function useMyLocation() {
  if (!navigator.geolocation) {
    showToast('⚠️', 'Tidak Didukung', 'Browser tidak mendukung geolokasi.', false);
    return;
  }

  const btn      = document.getElementById('btnGps');
  const original = btn.innerHTML;
  btn.innerHTML  = '📡 Mengambil lokasi…';
  btn.disabled   = true;

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude: lat, longitude: lng } = pos.coords;
      map.setView([lat, lng], 16);
      marker.setLatLng([lat, lng]);
      updateCoordBadge();
      btn.innerHTML = original;
      btn.disabled  = false;
    },
    (err) => {
      showToast('⚠️', 'GPS Gagal', 'Gagal mengambil lokasi: ' + err.message, false);
      btn.innerHTML = original;
      btn.disabled  = false;
    },
    { enableHighAccuracy: true, timeout: 10000 },
  );
}

/* ═══════════════════════════════════════════
   SUPABASE — Load Telegram Credentials
   Supports two table schemas:
     A) Key-value: columns = key, value
        rows: [{key:"telegram_token",value:"..."}, {key:"telegram_chat_id",value:"..."}]
     B) Direct columns: telegram_token, telegram_chat_id (or token, chat_id)
   ═══════════════════════════════════════════ */
async function loadTelegramConfig() {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/settings?select=*&limit=10`, {
      headers: {
        apikey:        SUPABASE_ANON,
        Authorization: `Bearer ${SUPABASE_ANON}`,
      },
    });

    if (!res.ok) throw new Error('Supabase request gagal: HTTP ' + res.status);

    const rows = await res.json();
    if (!rows.length) throw new Error('Tabel settings kosong.');

    // ── Schema A: key-value table (key, value) ──
    if (rows[0].key !== undefined && rows[0].value !== undefined) {
      for (const row of rows) {
        if (row.key === 'telegram_token')   telegramToken  = row.value;
        if (row.key === 'telegram_chat_id') telegramChatId = row.value;
      }
    }
    // ── Schema B: direct columns ──
    else {
      telegramToken  = rows[0].telegram_token  || rows[0].token  || null;
      telegramChatId = rows[0].telegram_chat_id || rows[0].chat_id || null;
    }

    if (!telegramToken || !telegramChatId) {
      console.warn('[LaporBencana] Token / Chat ID tidak ditemukan. Pastikan tabel settings berisi key telegram_token & telegram_chat_id.');
    } else {
      console.info('[LaporBencana] Konfigurasi Telegram berhasil dimuat.');
    }
  } catch (e) {
    console.error('[LaporBencana] Gagal memuat konfigurasi:', e);
  }
}

/* ═══════════════════════════════════════════
   FORM — Validation & Submission
   ═══════════════════════════════════════════ */

/** Validate and submit the disaster report */
async function submitReport() {
  const nama      = document.getElementById('nama').value.trim();
  const jenis     = document.getElementById('jenis').value;
  const deskripsi = document.getElementById('deskripsi').value.trim();
  const { lat, lng } = getCoords();

  // Validate
  if (!nama || !jenis || !deskripsi) {
    showToast('⚠️', 'Data Belum Lengkap', 'Harap isi semua kolom yang diperlukan.', false);
    return;
  }
  if (!telegramToken || !telegramChatId) {
    showToast('❌', 'Konfigurasi Hilang', 'Token Telegram belum termuat. Coba refresh halaman.', false);
    return;
  }

  // UI: loading state
  const btn     = document.getElementById('btnSubmit');
  const spinner = document.getElementById('spinner');
  const btnText = document.getElementById('btnText');

  btn.disabled       = true;
  spinner.style.display = 'block';
  btnText.textContent   = 'Mengirim laporan…';

  // Build Telegram message
  const mapsLink = `https://www.google.com/maps?q=${lat},${lng}`;
  const timestamp = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });

  const text = [
    '🚨 *LAPORAN BENCANA BARU*',
    '━━━━━━━━━━━━━━━━━━━━',
    `👤 *Nama Pelapor:* ${escapeMarkdown(nama)}`,
    `📋 *Jenis Bencana:* ${jenis}`,
    `📝 *Deskripsi:*`,
    escapeMarkdown(deskripsi),
    '',
    `📍 *Koordinat:* ${lat.toFixed(6)}, ${lng.toFixed(6)}`,
    `🗺️ *Google Maps:* ${mapsLink}`,
    '━━━━━━━━━━━━━━━━━━━━',
    `⏱️ ${timestamp} WIB`,
  ].join('\n');

  try {
    const tgRes = await fetch(
      `https://api.telegram.org/bot${telegramToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id:               telegramChatId,
          text,
          parse_mode:            'Markdown',
          disable_web_page_preview: true,
        }),
      },
    );

    const tgData = await tgRes.json();
    if (!tgData.ok) throw new Error(tgData.description || 'Telegram API error');

    showToast('✅', 'Laporan Terkirim!', 'Petugas akan segera menindaklanjuti laporan Anda.', true);
    resetForm();
  } catch (e) {
    console.error('[LaporBencana] Kirim gagal:', e);
    showToast('❌', 'Gagal Terkirim', 'Terjadi kesalahan: ' + e.message, false);
  } finally {
    btn.disabled       = false;
    spinner.style.display = 'none';
    btnText.textContent   = '🚨 Kirim Laporan Darurat';
  }
}

/** Reset form fields and map */
function resetForm() {
  document.getElementById('nama').value = '';
  document.getElementById('jenis').selectedIndex = 0;
  document.getElementById('deskripsi').value = '';
  resetMap();
}

/** Escape Telegram Markdown special chars */
function escapeMarkdown(text) {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
}

/* ═══════════════════════════════════════════
   TOAST — Notification System
   ═══════════════════════════════════════════ */
function showToast(icon, title, msg) {
  document.getElementById('toastIcon').textContent = icon;
  document.getElementById('toastTitle').textContent = title;
  document.getElementById('toastMsg').textContent   = msg;
  document.getElementById('toastOverlay').classList.add('show');
}

function closeToast() {
  document.getElementById('toastOverlay').classList.remove('show');
}

/* ═══════════════════════════════════════════
   INIT
   ═══════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  // Load Telegram config from Supabase
  loadTelegramConfig();

  // Copyright year (auto-update, from COPYRIGHT.md pattern)
  const el = document.getElementById('copyright-text');
  if (el) el.textContent = `© ${new Date().getFullYear()} KingSyah`;

  // Event listeners
  document.getElementById('btnGps').addEventListener('click', useMyLocation);
  document.getElementById('btnReset').addEventListener('click', resetMap);
  document.getElementById('btnSubmit').addEventListener('click', submitReport);
  document.getElementById('toastClose').addEventListener('click', closeToast);
  document.getElementById('toastOverlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeToast();
  });
});
