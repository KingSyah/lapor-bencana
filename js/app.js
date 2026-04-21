/* ═══════════════════════════════════════════
   LAPOR BENCANA — app.js
   ═══════════════════════════════════════════ */

/* ── Service Worker Registration ── */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('js/sw.js')
      .then((reg) => console.info('[PWA] Service Worker registered:', reg.scope))
      .catch((err) => console.warn('[PWA] Service Worker registration failed:', err));
  });
}

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

/* ── Media Upload State ── */
let selectedFile = null;  // File object or null

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
      console.warn('[LaporBencana] Rows dari Supabase:', JSON.stringify(rows).substring(0, 500));
    } else {
      console.info('[LaporBencana] Konfigurasi Telegram berhasil dimuat.');
      console.info('[LaporBencana] Chat ID:', telegramChatId, '| Token prefix:', telegramToken.substring(0, 10) + '...');
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
      `${SUPABASE_URL}/rest/v1/reports?select=*,upvotes&order=created_at.desc&limit=20&expires_at=gt.${new Date().toISOString()}`,
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

    // Detect crisis clusters for highlight
    const crisisIds = detectCrisisClusters(reports);

    // Render list & map markers
    listEl.innerHTML = reports.map((r, i) => {
      const emoji = getTypeEmoji(r.type);
      const time  = formatTimeAgo(r.created_at);
      const votes = r.upvotes || 0;
      const voted = hasVoted(r.id);
      const votedClass = voted ? 'voted' : '';
      const votedLabel = voted ? '👍✓' : '👍';
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
            <div class="report-actions">
              <button class="btn-upvote ${votedClass}" onclick="handleUpvote('${r.id}', this)" ${voted ? 'disabled' : ''} title="Validasi laporan ini">
                ${votedLabel} <span class="vote-count">${votes}</span>
              </button>
            </div>
          </div>
          <button class="report-map-btn" onclick="flyToReport(${r.lat},${r.lng})" title="Lihat di peta">📍</button>
        </div>`;
    }).join('');

    // Add markers to map
    reports.forEach((r) => {
      const emoji = getTypeEmoji(r.type);
      const isCrisis = crisisIds.has(r.id);
      const markerClass = isCrisis ? 'crisis-marker' : '';
      const markerHtml = isCrisis
        ? `<div class="crisis-marker" style="font-size:1.3rem;text-align:center;line-height:1;filter:drop-shadow(0 0 4px rgba(230,57,70,.8))">${emoji}</div>`
        : `<div style="font-size:1.1rem;text-align:center;line-height:1;filter:drop-shadow(0 1px 2px rgba(0,0,0,.3))">${emoji}</div>`;

      const m = L.marker([r.lat, r.lng], {
        icon: L.divIcon({
          className: markerClass,
          html: markerHtml,
          iconSize: isCrisis ? [28, 28] : [22, 22],
          iconAnchor: isCrisis ? [14, 14] : [11, 11],
          zIndexOffset: isCrisis ? 1000 : 0,
        }),
      });

      const upvoteInfo = (r.upvotes || 0) > 0 ? `<br><span style="font-size:.72rem;color:var(--orange)">👍 ${r.upvotes} validasi</span>` : '';
      m.bindPopup(`
        <div style="font-size:.82rem;line-height:1.5;min-width:160px">
          <strong>${escapeHtml(r.type)}</strong><br>
          <span style="color:#6e6e73">${escapeHtml(r.description)}</span><br>
          <span style="font-size:.72rem;color:#999">👤 ${escapeHtml(r.name)} · ${formatTimeAgo(r.created_at)}</span>
          ${upvoteInfo}
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
   MEDIA UPLOAD — Optional photo/video
   ═══════════════════════════════════════════ */
const MAX_PHOTO_SIZE = 10 * 1024 * 1024;  // 10 MB
const MAX_VIDEO_SIZE = 50 * 1024 * 1024;  // 50 MB

function setupMediaUpload() {
  const zone      = document.getElementById('uploadZone');
  const input     = document.getElementById('mediaInput');
  const placeholder = document.getElementById('uploadPlaceholder');
  const preview   = document.getElementById('uploadPreview');
  const previewImg  = document.getElementById('previewImg');
  const previewVideo = document.getElementById('previewVideo');
  const fileInfo  = document.getElementById('uploadFileInfo');
  const removeBtn = document.getElementById('uploadRemove');

  // Click zone → open file picker
  zone.addEventListener('click', (e) => {
    if (e.target === removeBtn || e.target.closest('.upload-remove')) return;
    input.click();
  });

  // File selected
  input.addEventListener('change', () => {
    const file = input.files[0];
    if (!file) return;
    handleFileSelect(file);
  });

  // Remove file
  removeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    clearMedia();
  });

  // Drag & drop
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.style.borderColor = 'var(--orange)'; });
  zone.addEventListener('dragleave', () => { zone.style.borderColor = ''; });
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.style.borderColor = '';
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  });

  function handleFileSelect(file) {
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    if (!isImage && !isVideo) {
      showToast('⚠️', 'Format Tidak Didukung', 'Hanya foto (JPG, PNG, WEBP) atau video (MP4) yang bisa dilampirkan.');
      return;
    }
    const maxSize = isImage ? MAX_PHOTO_SIZE : MAX_VIDEO_SIZE;
    if (file.size > maxSize) {
      const limit = isImage ? '10 MB' : '50 MB';
      showToast('📦', 'File Terlalu Besar', `Ukuran maksimal ${limit}.`);
      return;
    }

    selectedFile = file;

    // Show preview
    const url = URL.createObjectURL(file);
    previewImg.style.display = 'none';
    previewVideo.style.display = 'none';
    if (isImage) {
      previewImg.src = url;
      previewImg.style.display = 'block';
    } else {
      previewVideo.src = url;
      previewVideo.style.display = 'block';
      previewVideo.play().catch(() => {});
    }

    const sizeStr = file.size < 1024 * 1024
      ? `${(file.size / 1024).toFixed(0)} KB`
      : `${(file.size / (1024 * 1024)).toFixed(1)} MB`;
    fileInfo.innerHTML = `<strong>${file.name}</strong>${sizeStr}`;

    placeholder.style.display = 'none';
    preview.style.display = 'flex';
    zone.classList.add('has-file');
  }
}

function clearMedia() {
  selectedFile = null;
  const input = document.getElementById('mediaInput');
  input.value = '';
  document.getElementById('uploadPlaceholder').style.display = 'flex';
  document.getElementById('uploadPreview').style.display = 'none';
  document.getElementById('uploadZone').classList.remove('has-file');
  const prog = document.getElementById('uploadProgress');
  prog.style.display = 'none';
  document.getElementById('uploadProgressBar').style.width = '0%';
  // Reset compression status
  const statusEl = document.getElementById('compressStatus');
  if (statusEl) {
    statusEl.style.display = 'none';
    statusEl.className = 'compress-status';
    statusEl.innerHTML = '';
  }
}

function showUploadProgress(percent) {
  const prog = document.getElementById('uploadProgress');
  prog.style.display = 'block';
  document.getElementById('uploadProgressBar').style.width = percent + '%';
}

/* ═══════════════════════════════════════════
   IMAGE COMPRESSION
   ═══════════════════════════════════════════ */
const COMPRESS_OPTIONS = {
  maxSizeMB:        0.5,      // target: di bawah 500 KB
  maxWidthOrHeight: 1920,     // resize jika lebih besar
  useWebWorker:     true,     // offload ke web worker
  fileType:         'image/jpeg', // output format (lebih kecil dari PNG)
  initialQuality:   0.8,     // kualitas awal
};

/** Check if compression is enabled by user */
function isCompressEnabled() {
  const cb = document.getElementById('compressCheck');
  return cb ? cb.checked : false;
}

/** Compress an image file using browser-image-compression */
async function compressImage(file) {
  const statusEl = document.getElementById('compressStatus');

  // Show status
  statusEl.style.display = 'flex';
  statusEl.className = 'compress-status compressing';
  statusEl.innerHTML = '⏳ Mengompres foto…';

  const originalSize = file.size;

  try {
    if (typeof imageCompression === 'undefined') {
      throw new Error('Library kompresi belum dimuat');
    }

    const compressed = await imageCompression(file, COMPRESS_OPTIONS);

    const ratio = ((1 - compressed.size / originalSize) * 100).toFixed(0);
    const origStr = formatFileSize(originalSize);
    const compStr = formatFileSize(compressed.size);

    if (compressed.size < originalSize) {
      statusEl.className = 'compress-status success';
      statusEl.innerHTML = `✅ Kompresi berhasil: ${origStr} → ${compStr} (−${ratio}%)`;
      console.info(`[LaporBencana] Compressed: ${origStr} → ${compStr} (−${ratio}%)`);
    } else {
      statusEl.className = 'compress-status success';
      statusEl.innerHTML = `✅ Foto sudah optimal (${origStr})`;
      console.info('[LaporBencana] File already optimal, skipping compression');
    }

    // Rename to .jpg since we convert to JPEG
    const newName = file.name.replace(/\.[^.]+$/, '.jpg');
    return new File([compressed], newName, { type: 'image/jpeg' });

  } catch (e) {
    console.warn('[LaporBencana] Compression failed:', e);
    statusEl.className = 'compress-status error';
    statusEl.innerHTML = `⚠️ Kompresi gagal, kirim asli (${formatFileSize(originalSize)})`;
    return file; // fallback: kirim file asli
  }
}

/** Format bytes to human-readable */
function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/* ═══════════════════════════════════════════
   SUBMIT
   ═══════════════════════════════════════════ */

/* ═══════════════════════════════════════════
   ANTI-SPAM
   ═══════════════════════════════════════════ */
const SPAM = {
  cooldownSec:    60,      // detik antar submit
  maxPerHour:     5,       // maks submit per jam
  minDescLength:  20,      // karakter minimum deskripsi
  storageKey:     'laporbencana_lastSubmit',
  historyKey:     'laporbencana_submitHistory',
};

/** Check if user is in cooldown period */
function isCooldown() {
  const last = parseInt(localStorage.getItem(SPAM.storageKey) || '0', 10);
  const elapsed = (Date.now() - last) / 1000;
  return elapsed < SPAM.cooldownSec ? Math.ceil(SPAM.cooldownSec - elapsed) : 0;
}

/** Get remaining submissions allowed this hour */
function getRemainingSubmissions() {
  const history = JSON.parse(localStorage.getItem(SPAM.historyKey) || '[]');
  const oneHourAgo = Date.now() - 3600000;
  const recent = history.filter((t) => t > oneHourAgo);
  // Clean old entries
  localStorage.setItem(SPAM.historyKey, JSON.stringify(recent));
  return SPAM.maxPerHour - recent.length;
}

/** Record a submission timestamp */
function recordSubmission() {
  localStorage.setItem(SPAM.storageKey, String(Date.now()));
  const history = JSON.parse(localStorage.getItem(SPAM.historyKey) || '[]');
  history.push(Date.now());
  localStorage.setItem(SPAM.historyKey, JSON.stringify(history));
}

/** Simple hash for duplicate detection */
function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return h;
}

/** Check if current form is duplicate of last submission */
function isDuplicate(nama, jenis, deskripsi, lat, lng) {
  const lastHash = localStorage.getItem('laporbencana_lastHash');
  const current  = simpleHash(`${nama}|${jenis}|${deskripsi}|${lat.toFixed(4)}|${lng.toFixed(4)}`).toString();
  return lastHash === current;
}

function saveHash(nama, jenis, deskripsi, lat, lng) {
  const h = simpleHash(`${nama}|${jenis}|${deskripsi}|${lat.toFixed(4)}|${lng.toFixed(4)}`).toString();
  localStorage.setItem('laporbencana_lastHash', h);
}

/** Show cooldown overlay with countdown */
function showCooldown(seconds) {
  const overlay = document.getElementById('cooldownOverlay');
  const label   = document.getElementById('cooldownLabel');
  const circle  = document.getElementById('cooldownCircle');

  const circumference = 2 * Math.PI * 35;
  circle.style.strokeDasharray  = circumference;
  circle.style.strokeDashoffset = circumference;

  overlay.classList.add('show');
  let remaining = seconds;

  const tick = () => {
    label.textContent = remaining;
    const progress = 1 - (remaining / seconds);
    circle.style.strokeDashoffset = circumference * (1 - progress);

    if (remaining <= 0) {
      overlay.classList.remove('show');
      return;
    }
    remaining--;
    setTimeout(tick, 1000);
  };
  tick();
}

/* ── Character Counter ── */
function setupCharCounter() {
  const textarea = document.getElementById('deskripsi');
  const counter  = document.getElementById('charCounter');
  const hint     = document.getElementById('charHint');

  textarea.addEventListener('input', () => {
    const len = textarea.value.trim().length;
    counter.textContent = `${len} / ${SPAM.minDescLength}`;

    if (len >= SPAM.minDescLength) {
      counter.className = 'char-counter ok';
      hint.className    = 'char-hint ok';
    } else if (len > 0) {
      counter.className = 'char-counter warn';
      hint.className    = 'char-hint warn';
    } else {
      counter.className = 'char-counter';
      hint.className    = 'char-hint';
    }
  });
}
async function submitReport() {
  const nama      = document.getElementById('nama').value.trim();
  const jenis     = document.getElementById('jenis').value;
  const deskripsi = document.getElementById('deskripsi').value.trim();
  const { lat, lng } = getCoords();

  // ── Anti-Spam: Honeypot ──
  if (document.getElementById('hp_website').value) {
    console.warn('[LaporBencana] Honeypot triggered — bot detected.');
    showToast('✅', 'Laporan Terkirim!', 'Terima kasih atas laporan Anda.');
    return;
  }

  // ── Anti-Spam: Cooldown ──
  const cooldownLeft = isCooldown();
  if (cooldownLeft > 0) {
    showCooldown(cooldownLeft);
    return;
  }

  // ── Anti-Spam: Rate Limit ──
  const remaining = getRemainingSubmissions();
  if (remaining <= 0) {
    showToast('⏳', 'Batas Tercapai', `Maksimal ${SPAM.maxPerHour} laporan per jam. Coba lagi nanti.`);
    return;
  }

  // ── Validate fields ──
  if (!nama || !jenis || !deskripsi) {
    showToast('⚠️', 'Data Belum Lengkap', 'Harap isi semua kolom yang diperlukan.');
    return;
  }
  if (deskripsi.length < SPAM.minDescLength) {
    showToast('📝', 'Deskripsi Terlalu Pendek', `Minimal ${SPAM.minDescLength} karakter untuk menjelaskan keadaan.`);
    return;
  }
  if (!telegramToken || !telegramChatId) {
    showToast('❌', 'Konfigurasi Hilang', 'Token Telegram belum termuat. Coba refresh halaman.');
    return;
  }

  // ── Anti-Spam: Duplicate ──
  if (isDuplicate(nama, jenis, deskripsi, lat, lng)) {
    showToast('🔄', 'Laporan Duplikat', 'Laporan yang sama sudah pernah dikirim.');
    return;
  }

  // UI: loading
  const btn     = document.getElementById('btnSubmit');
  const spinner = document.getElementById('spinner');
  const btnText = document.getElementById('btnText');
  btn.disabled       = true;
  spinner.style.display = 'block';
  btnText.textContent   = 'Mengirim laporan…';

  // Telegram message (caption for media, text for text-only)
  const mapsLink  = `https://www.google.com/maps?q=${lat},${lng}`;
  const timestamp = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });

  const caption = [
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
    // 1. Send to Telegram — with or without media
    let tgRes, tgData;
    let fileToSend = selectedFile;

    if (selectedFile) {
      const isImage = selectedFile.type.startsWith('image/');
      const isVideo = selectedFile.type.startsWith('video/');

      // ── Compress image if enabled ──
      if (isImage && isCompressEnabled()) {
        fileToSend = await compressImage(selectedFile);
      }

      // ── Send with media (FormData: sendPhoto / sendVideo) ──
      const endpoint = isVideo ? 'sendVideo' : 'sendPhoto';
      const fileField = isVideo ? 'video' : 'photo';

      const formData = new FormData();
      formData.append('chat_id', telegramChatId);
      formData.append(fileField, fileToSend);
      formData.append('caption', caption);
      formData.append('parse_mode', 'Markdown');

      console.info(`[LaporBencana] Mengirim ${endpoint}:`, fileToSend.name, `(${(fileToSend.size / 1024).toFixed(0)} KB)`);

      // Use XMLHttpRequest for upload progress tracking
      tgData = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `https://api.telegram.org/bot${telegramToken}/${endpoint}`);

        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            showUploadProgress(Math.round((e.loaded / e.total) * 100));
          }
        });

        xhr.addEventListener('load', () => {
          console.info(`[LaporBencana] ${endpoint} response:`, xhr.status, xhr.responseText.substring(0, 500));
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              resolve(JSON.parse(xhr.responseText));
            } catch (_) {
              reject(new Error('Respons Telegram tidak valid'));
            }
          } else {
            // HTTP error — coba parse body untuk dapat error dari Telegram
            let errMsg = `HTTP ${xhr.status}`;
            try {
              const errData = JSON.parse(xhr.responseText);
              errMsg = errData.description || errMsg;
            } catch (_) { /* body bukan JSON */ }
            reject(new Error(errMsg));
          }
        });

        xhr.addEventListener('error', () => {
          console.error('[LaporBencana] XHR network error (kemungkinan CORS):', endpoint);
          reject(new Error('Gagal terhubung ke Telegram. Cek koneksi internet.'));
        });

        xhr.send(formData);
      });

      // Auto-handle migrasi grup → supergroup
      if (!tgData.ok && tgData.parameters?.migrate_to_chat_id) {
        const newChatId = tgData.parameters.migrate_to_chat_id;
        console.warn(`[LaporBencana] Grup bermigrasi! Chat ID baru: ${newChatId}`);
        telegramChatId = newChatId;
        formData.set('chat_id', telegramChatId);

        // Retry dengan chat_id baru
        tgData = await new Promise((resolve, reject) => {
          const xhr2 = new XMLHttpRequest();
          xhr2.open('POST', `https://api.telegram.org/bot${telegramToken}/${endpoint}`);
          xhr2.addEventListener('load', () => {
            try { resolve(JSON.parse(xhr2.responseText)); }
            catch (_) { reject(new Error('Respons Telegram tidak valid')); }
          });
          xhr2.addEventListener('error', () => reject(new Error('Gagal terhubung ke Telegram.')));
          xhr2.send(formData);
        });
        console.info('[LaporBencana] Retry', endpoint, 'response:', tgData.ok);
      }

      if (!tgData.ok) throw new Error(tgData.description || 'Telegram API error');

    } else {
      // ── Text-only (sendMessage) ──
      console.info('[LaporBencana] Mengirim sendMessage (tanpa media)');
      tgRes = await fetch(
        `https://api.telegram.org/bot${telegramToken}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id:               telegramChatId,
            text:                  caption,
            parse_mode:            'Markdown',
            disable_web_page_preview: true,
          }),
        },
      );
      tgData = await tgRes.json();

      // Auto-handle migrasi grup → supergroup (Telegram kirim migrate_to_chat_id)
      if (!tgData.ok && tgData.parameters?.migrate_to_chat_id) {
        const newChatId = tgData.parameters.migrate_to_chat_id;
        console.warn(`[LaporBencana] Grup bermigrasi! Chat ID baru: ${newChatId}`);
        telegramChatId = newChatId;

        // Retry dengan chat_id baru
        tgRes = await fetch(
          `https://api.telegram.org/bot${telegramToken}/sendMessage`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id:               telegramChatId,
              text:                  caption,
              parse_mode:            'Markdown',
              disable_web_page_preview: true,
            }),
          },
        );
        tgData = await tgRes.json();
        console.info('[LaporBencana] Retry sendMessage response:', tgRes.status);
      }

      if (!tgData.ok) throw new Error(tgData.description || 'Telegram API error');
    }

    // 2. Save to Supabase (best effort)
    await saveReportToSupabase(nama, jenis, deskripsi, lat, lng);

    success = true;
    recordSubmission();
    saveHash(nama, jenis, deskripsi, lat, lng);
    showToast('✅', 'Laporan Terkirim!', `Petugas akan segera menindaklanjuti. (Tersisa ${getRemainingSubmissions()} laporan/jam)`);
    resetForm();

    // 3. Refresh reports list
    loadReports();

  } catch (e) {
    console.error('[LaporBencana] Kirim gagal:', e);
    showToast('❌', 'Gagal Terkirim', 'Error: ' + (e.message || 'Tidak diketahui'));
    console.error('[LaporBencana] Debug info:', {
      telegramToken: telegramToken ? telegramToken.substring(0, 10) + '...' : null,
      telegramChatId,
      hasFile: !!selectedFile,
      fileName: selectedFile?.name,
      compressedFile: fileToSend !== selectedFile ? fileToSend?.name : null,
    });
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
  clearMedia();
  resetMap();
}

function escapeMarkdown(text) {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
}

/* ═══════════════════════════════════════════
   v1.7.0 — UPVOTE / VALIDASI
   ═══════════════════════════════════════════ */
const UPVOTE_KEY = 'laporbencana_upvoted';

/** Check if user already voted for this report */
function hasVoted(reportId) {
  const voted = JSON.parse(localStorage.getItem(UPVOTE_KEY) || '[]');
  return voted.includes(reportId);
}

/** Record vote locally */
function recordVote(reportId) {
  const voted = JSON.parse(localStorage.getItem(UPVOTE_KEY) || '[]');
  voted.push(reportId);
  localStorage.setItem(UPVOTE_KEY, JSON.stringify(voted));
}

/** Handle upvote click */
async function handleUpvote(reportId, btnEl) {
  if (hasVoted(reportId)) return;

  // Optimistic UI update
  const countEl = btnEl.querySelector('.vote-count');
  const currentCount = parseInt(countEl.textContent, 10) || 0;
  countEl.textContent = currentCount + 1;
  btnEl.classList.add('voted');
  btnEl.disabled = true;
  btnEl.innerHTML = '👍✓ <span class="vote-count">' + (currentCount + 1) + '</span>';

  try {
    // Increment upvotes in Supabase
    const res = await fetch(`${SUPABASE_URL}/rest/v1/reports?id=eq.${reportId}`, {
      method: 'PATCH',
      headers: {
        ...SB_HEADERS,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        upvotes: currentCount + 1,
      }),
    });

    if (!res.ok) {
      // Rollback UI on failure
      countEl.textContent = currentCount;
      btnEl.classList.remove('voted');
      btnEl.disabled = false;
      btnEl.innerHTML = '👍 <span class="vote-count">' + currentCount + '</span>';
      showToast('⚠️', 'Gagal', 'Tidak bisa menyimpan validasi. Coba lagi.');
      return;
    }

    recordVote(reportId);
    console.info('[LaporBencana] Upvote berhasil untuk report:', reportId);
  } catch (e) {
    // Rollback on network error
    countEl.textContent = currentCount;
    btnEl.classList.remove('voted');
    btnEl.disabled = false;
    btnEl.innerHTML = '👍 <span class="vote-count">' + currentCount + '</span>';
    showToast('⚠️', 'Gagal', 'Koneksi bermasalah. Coba lagi.');
  }
}

/* ═══════════════════════════════════════════
   v1.7.0 — CRISIS CLUSTER DETECTION
   ═══════════════════════════════════════════ */

/** Haversine distance in meters between two coordinates */
function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000; // Earth radius in meters
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Detect crisis clusters: reports within 50m of each other OR high upvotes */
function detectCrisisClusters(reports) {
  const crisisIds = new Set();
  const CLUSTER_RADIUS = 50;   // meters
  const HIGH_UPVOTE    = 3;    // threshold for "high" upvote

  for (let i = 0; i < reports.length; i++) {
    // High upvote = crisis
    if ((reports[i].upvotes || 0) >= HIGH_UPVOTE) {
      crisisIds.add(reports[i].id);
    }

    // Cluster detection
    for (let j = i + 1; j < reports.length; j++) {
      const dist = haversineDistance(
        reports[i].lat, reports[i].lng,
        reports[j].lat, reports[j].lng,
      );
      if (dist < CLUSTER_RADIUS) {
        crisisIds.add(reports[i].id);
        crisisIds.add(reports[j].id);
      }
    }
  }

  return crisisIds;
}

/* ═══════════════════════════════════════════
   v1.7.0 — MAP FULLSCREEN
   ═══════════════════════════════════════════ */
let mapExpanded = false;

function setupMapFullscreen() {
  const btn = document.getElementById('btnMapExpand');
  const wrapper = document.getElementById('mapWrapper');

  btn.addEventListener('click', () => {
    mapExpanded = !mapExpanded;
    if (mapExpanded) {
      wrapper.classList.add('map-expanded');
      btn.textContent = '✕';
      btn.title = 'Tutup Peta';
      document.body.style.overflow = 'hidden';
    } else {
      wrapper.classList.remove('map-expanded');
      btn.textContent = '⛶';
      btn.title = 'Perbesar Peta';
      document.body.style.overflow = '';
    }
    // Invalidate map size after transition
    setTimeout(() => map.invalidateSize(), 300);
  });

  // Close expanded map when clicking the bottom bar
  wrapper.addEventListener('click', (e) => {
    if (mapExpanded && e.target === wrapper.querySelector('::after')) {
      btn.click();
    }
  });
}

/* ═══════════════════════════════════════════
   v1.7.0 — DARK MODE
   ═══════════════════════════════════════════ */
const DARK_KEY = 'laporbencana_darkmode';

function setupDarkMode() {
  const btn = document.getElementById('btnDarkToggle');
  const icon = btn.querySelector('.dark-icon');

  // Load saved preference
  const saved = localStorage.getItem(DARK_KEY);
  if (saved === 'true') {
    document.body.classList.add('dark');
    icon.textContent = '☀️';
  }

  btn.addEventListener('click', () => {
    const isDark = document.body.classList.toggle('dark');
    icon.textContent = isDark ? '☀️' : '🌙';
    localStorage.setItem(DARK_KEY, isDark);
  });
}

/* ═══════════════════════════════════════════
   v1.7.0 — FAB REFRESH
   ═══════════════════════════════════════════ */
function setupFabRefresh() {
  const fab = document.getElementById('btnFabRefresh');
  fab.addEventListener('click', () => {
    fab.classList.add('spinning');
    // Local refresh: reload reports + reinit map, bukan full page reload
    loadReports();
    setTimeout(() => fab.classList.remove('spinning'), 600);
  });
}

/* ═══════════════════════════════════════════
   v1.7.0 — EMERGENCY NUMBERS TAB
   ═══════════════════════════════════════════ */
function setupEmergencyTab() {
  const trigger = document.getElementById('emergencyTrigger');
  const panel   = document.getElementById('emergencyPanel');

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = panel.classList.toggle('show');
    trigger.classList.toggle('active', isOpen);
  });

  // Close when clicking outside
  document.addEventListener('click', (e) => {
    if (!panel.contains(e.target) && e.target !== trigger) {
      panel.classList.remove('show');
      trigger.classList.remove('active');
    }
  });

  // Close when clicking a link (dial a number)
  panel.querySelectorAll('.emergency-item').forEach((item) => {
    item.addEventListener('click', () => {
      panel.classList.remove('show');
      trigger.classList.remove('active');
    });
  });
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

  // Character counter for description
  setupCharCounter();

  // Media upload (optional photo/video)
  setupMediaUpload();

  // v1.7.0 features
  setupDarkMode();
  setupMapFullscreen();
  setupFabRefresh();
  setupEmergencyTab();

  // Show logo bar only if real logos exist
  const logoBar = document.querySelector('.logo-bar');
  if (logoBar && logoBar.querySelectorAll('.logo-item').length > 0) {
    logoBar.classList.add('visible');
  }
});
