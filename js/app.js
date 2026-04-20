/* ═══════════════════════════════════════════
   LAPOR BENCANA — app.js
   ═══════════════════════════════════════════ */

/* ── Config: Supabase ── */
const SUPABASE_URL  = 'https://lfjajcxotlypisupiedi.supabase.co';
const SUPABASE_ANON = 'sb_publishable_1bSLL_4J0acZA19IwYYnLw_q8DX0c5b';

/* ── Supabase Headers ── */
const SB_HEADERS = {
  apikey:        SUPABASE_ANON,
  Authorization: `Bearer ${SUPABASE_ANON}`,
  'Content-Type':'application/json',
  Prefer:        'return=representation',
};

let telegramToken  = null;
let telegramChatId = null;
let reportMarkers  = L.layerGroup();   // layer untuk marker laporan

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

// Layer group untuk laporan
reportMarkers.addTo(map);

// Marker utama (draggable)
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

function getCoords() {
  return marker.getLatLng();
}

function updateCoordBadge() {
  const { lat, lng } = getCoords();
  document.getElementById('coordBadge').textContent =
    `Koordinat: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function resetMap() {
  map.setView(LANGSA, 13);
  marker.setLatLng(LANGSA);
  updateCoordBadge();
}

function useMyLocation() {
  if (!navigator.geolocation) {
    showToast('⚠️', 'Tidak Didukung', 'Browser tidak mendukung geolokasi.');
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
      showToast('⚠️', 'GPS Gagal', 'Gagal mengambil lokasi: ' + err.message);
      btn.innerHTML = original;
      btn.disabled  = false;
    },
    { enableHighAccuracy: true, timeout: 10000 },
  );
}

/* ═══════════════════════════════════════════
   SUPABASE — Load Telegram Credentials
   ═══════════════════════════════════════════ */
async function loadTelegramConfig() {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/settings?select=*&limit=10`, {
      headers: SB_HEADERS,
    });
    if (!res.ok) throw new Error('Supabase request gagal: HTTP ' + res.status);

    const rows = await res.json();
    if (!rows.length) throw new Error('Tabel settings kosong.');

    // Schema A: key-value
    if (rows[0].key !== undefined && rows[0].value !== undefined) {
      for (const row of rows) {
        if (row.key === 'telegram_token')   telegramToken  = row.value;
        if (row.key === 'telegram_chat_id') telegramChatId = row.value;
      }
    }
    // Schema B: direct columns
    else {
      telegramToken  = rows[0].telegram_token  || rows[0].token  || null;
      telegramChatId = rows[0].telegram_chat_id || rows[0].chat_id || null;
    }

    if (!telegramToken || !telegramChatId) {
      console.warn('[LaporBencana] Token/Chat ID tidak ditemukan di tabel settings.');
    } else {
      console.info('[LaporBencana] Konfigurasi Telegram berhasil dimuat.');
    }
  } catch (e) {
    console.error('[LaporBencana] Gagal memuat konfigurasi:', e);
  }
}

/* ═══════════════════════════════════════════
   REPORTS — Save & Load from Supabase
   ═══════════════════════════════════════════ */

/** Save a report to Supabase `reports` table */
async function saveReportToSupabase(nama, jenis, deskripsi, lat, lng) {
  try {
    // Expired 7 hari dari sekarang
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const res = await fetch(`${SUPABASE_URL}/rest/v1/reports`, {
      method: 'POST',
      headers: SB_HEADERS,
      body: JSON.stringify({
        name:        nama,
        type:        jenis,
        description: deskripsi,
        lat:         parseFloat(lat.toFixed(6)),
        lng:         parseFloat(lng.toFixed(6)),
        created_at:  new Date().toISOString(),
        expires_at:  expiresAt,
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.warn('[LaporBencana] Gagal simpan ke Supabase:', res.status, errText);
      return false;
    }
    console.info('[LaporBencana] Laporan tersimpan di Supabase (expires:', expiresAt, ')');
    return true;
  } catch (e) {
    console.warn('[LaporBencana] Gagal simpan ke Supabase:', e);
    return false;
  }
}

/** Load recent reports from Supabase and render */
async function loadReports() {
  const listEl  = document.getElementById('reportsList');
  const cardEl  = document.getElementById('reportsCard');
  const countEl = document.getElementById('reportsCount');

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/reports?select=*&order=created_at.desc&limit=20&expires_at=gt.${new Date().toISOString()}`,
      { headers: SB_HEADERS },
    );
    if (!res.ok) throw new Error('HTTP ' + res.status);

    const reports = await res.json();
    if (!reports.length) {
      cardEl.style.display = 'block';
      listEl.innerHTML = `
        <div class="report-empty">
          <span class="report-empty-icon">📭</span>
          Belum ada laporan. Jadilah yang pertama!
        </div>`;
      countEl.textContent = '';
      return;
    }

    // Show card & count
    cardEl.style.display = 'block';
    countEl.textContent = `${reports.length} laporan`;

    // Clear old markers
    reportMarkers.clearLayers();

    // Render list & map markers
    listEl.innerHTML = reports.map((r, i) => {
      const emoji = getTypeEmoji(r.type);
      const time  = formatTimeAgo(r.created_at);
      return `
        <div class="report-item" data-idx="${i}">
          <div class="report-icon">${emoji}</div>
          <div class="report-body">
            <div class="report-type">${escapeHtml(r.type)}</div>
            <div class="report-desc">${escapeHtml(r.description)}</div>
            <div class="report-meta">
              <span>👤 ${escapeHtml(r.name)}</span>
              <span>⏱️ ${time}</span>
            </div>
          </div>
          <button class="report-map-btn" onclick="flyToReport(${r.lat},${r.lng})" title="Lihat di peta">📍</button>
        </div>`;
    }).join('');

    // Add markers to map
    reports.forEach((r) => {
      const emoji = getTypeEmoji(r.type);
      const m = L.marker([r.lat, r.lng], {
        icon: L.divIcon({
          className: '',
          html: `<div style="font-size:1.1rem;text-align:center;line-height:1;filter:drop-shadow(0 1px 2px rgba(0,0,0,.3))">${emoji}</div>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        }),
      });
      m.bindPopup(`
        <div style="font-size:.82rem;line-height:1.5;min-width:160px">
          <strong>${escapeHtml(r.type)}</strong><br>
          <span style="color:#6e6e73">${escapeHtml(r.description)}</span><br>
          <span style="font-size:.72rem;color:#999">👤 ${escapeHtml(r.name)} · ${formatTimeAgo(r.created_at)}</span>
        </div>
      `);
      reportMarkers.addLayer(m);
    });

  } catch (e) {
    console.warn('[LaporBencana] Gagal memuat laporan:', e);
    // Tampilkan card tapi dengan pesan error ringan
    cardEl.style.display = 'block';
    listEl.innerHTML = `
      <div class="report-empty">
        <span class="report-empty-icon">⚠️</span>
        Gagal memuat laporan. Coba lagi nanti.
      </div>`;
  }
}

/** Fly map to a report location */
function flyToReport(lat, lng) {
  map.flyTo([lat, lng], 16, { duration: 0.8 });
  // Open popup of nearest marker
  reportMarkers.eachLayer((layer) => {
    const ll = layer.getLatLng();
    if (Math.abs(ll.lat - lat) < 0.0001 && Math.abs(ll.lng - lng) < 0.0001) {
      layer.openPopup();
    }
  });
}

/** Extract emoji from type string */
function getTypeEmoji(type) {
  if (!type) return '⚠️';
  const match = type.match(/^(\p{Emoji_Presentation}|\p{Extended_Pictographic})/u);
  return match ? match[0] : '⚠️';
}

/** Format ISO date to relative time (id) */
function formatTimeAgo(isoString) {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'baru saja';
  if (mins < 60) return `${mins}m lalu`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}j lalu`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}h lalu`;
  return new Date(isoString).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

/** Clean up expired reports from Supabase (best effort, fire & forget) */
async function cleanupExpiredReports() {
  try {
    await fetch(
      `${SUPABASE_URL}/rest/v1/reports?expires_at=lt.${new Date().toISOString()}`,
      { method: 'DELETE', headers: SB_HEADERS },
    );
    console.info('[LaporBencana] Expired reports cleaned up.');
  } catch (e) {
    // Silent fail — tidak mengganggu user
    console.debug('[LaporBencana] Cleanup skipped:', e.message);
  }
}

/* ═══════════════════════════════════════════
   FORM — Validation & Submission
   ═══════════════════════════════════════════ */
async function submitReport() {
  const nama      = document.getElementById('nama').value.trim();
  const jenis     = document.getElementById('jenis').value;
  const deskripsi = document.getElementById('deskripsi').value.trim();
  const { lat, lng } = getCoords();

  if (!nama || !jenis || !deskripsi) {
    showToast('⚠️', 'Data Belum Lengkap', 'Harap isi semua kolom yang diperlukan.');
    return;
  }
  if (!telegramToken || !telegramChatId) {
    showToast('❌', 'Konfigurasi Hilang', 'Token Telegram belum termuat. Coba refresh halaman.');
    return;
  }

  // UI: loading
  const btn     = document.getElementById('btnSubmit');
  const spinner = document.getElementById('spinner');
  const btnText = document.getElementById('btnText');
  btn.disabled       = true;
  spinner.style.display = 'block';
  btnText.textContent   = 'Mengirim laporan…';

  // Telegram message
  const mapsLink  = `https://www.google.com/maps?q=${lat},${lng}`;
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

  let success = false;

  try {
    // 1. Send to Telegram
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

    // 2. Save to Supabase (best effort)
    await saveReportToSupabase(nama, jenis, deskripsi, lat, lng);

    success = true;
    showToast('✅', 'Laporan Terkirim!', 'Petugas akan segera menindaklanjuti laporan Anda.');
    resetForm();

    // 3. Refresh reports list
    loadReports();

  } catch (e) {
    console.error('[LaporBencana] Kirim gagal:', e);
    showToast('❌', 'Gagal Terkirim', 'Terjadi kesalahan: ' + e.message);
  } finally {
    btn.disabled       = false;
    spinner.style.display = 'none';
    btnText.textContent   = '🚨 Kirim Laporan Darurat';
  }
}

function resetForm() {
  document.getElementById('nama').value = '';
  document.getElementById('jenis').selectedIndex = 0;
  document.getElementById('deskripsi').value = '';
  resetMap();
}

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

  // Load existing reports
  loadReports();

  // Cleanup expired reports (best effort)
  cleanupExpiredReports();

  // Copyright year (auto-update, from COPYRIGHT.md pattern)
  const el = document.getElementById('copyright-text');
  if (el) el.textContent = `© ${new Date().getFullYear()} KingSyah`;

  // Event listeners
  document.getElementById('btnGps').addEventListener('click', useMyLocation);
  document.getElementById('btnReset').addEventListener('click', resetMap);
  document.getElementById('btnSubmit').addEventListener('click', submitReport);
  document.getElementById('btnRefresh').addEventListener('click', loadReports);
  document.getElementById('toastClose').addEventListener('click', closeToast);
  document.getElementById('toastOverlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeToast();
  });
});
