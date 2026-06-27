/* ===========================================================
   HearText AI — Application Logic
   Router SPA + Web Speech API (SpeechRecognition & SpeechSynthesis)
   =========================================================== */

(function () {
  "use strict";

  /* -----------------------------------------------------------
     0. Small helpers
  ----------------------------------------------------------- */
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function showToast(message, isError = false) {
    const toast = $("#toast");
    const icon = $("#toastIcon");
    $("#toastMessage").textContent = message;
    icon.textContent = isError ? "error" : "check_circle";
    toast.classList.toggle("error", isError);
    toast.classList.add("is-visible");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.remove("is-visible"), 2800);
  }

  function downloadTextFile(filename, text) {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /* -----------------------------------------------------------
     1. Router (SPA navigation)
  ----------------------------------------------------------- */
  const pageTitles = {
    dashboard: "Dashboard",
    stt: "Live STT",
    tts: "Message TTS",
    support: "Bantuan AI",
    settings: "Pengaturan",
  };

  function navigateTo(pageId) {
    if (!pageTitles[pageId]) pageId = "dashboard";

    $$(".page").forEach((p) => p.classList.remove("is-active"));
    const target = $("#page-" + pageId);
    if (target) target.classList.add("is-active");

    $$(".nav-link").forEach((link) => {
      link.classList.toggle("active", link.dataset.page === pageId);
    });

    $("#topbarTitle").textContent = pageTitles[pageId];
    window.location.hash = pageId;

    // Close mobile nav on navigation
    closeMobileNav();

    // Stop any ongoing speech/recognition when leaving their pages
    if (pageId !== "stt" && STT.isListening) STT.stop();
    if (pageId !== "tts") TTS.cancel();
  }

  function initRouter() {
    $$(".nav-link").forEach((link) => {
      link.addEventListener("click", () => navigateTo(link.dataset.page));
    });
    $$("[data-nav]").forEach((el) => {
      el.addEventListener("click", () => {
        const target = el.dataset.nav;
        if (pageTitles[target]) navigateTo(target);
        else showToast("Fitur riwayat lengkap akan segera tersedia.");
      });
    });

    const initial = window.location.hash.replace("#", "") || "dashboard";
    navigateTo(initial);

    window.addEventListener("hashchange", () => {
      navigateTo(window.location.hash.replace("#", ""));
    });
  }

  /* -----------------------------------------------------------
     2. Mobile nav (hamburger)
  ----------------------------------------------------------- */
  function openMobileNav() {
    $("#sidenav").classList.add("is-open");
    $("#navOverlay").classList.add("is-visible");
  }
  function closeMobileNav() {
    $("#sidenav").classList.remove("is-open");
    $("#navOverlay").classList.remove("is-visible");
  }
  function initMobileNav() {
    $("#navMenuBtn").addEventListener("click", openMobileNav);
    $("#navOverlay").addEventListener("click", closeMobileNav);
  }

  /* -----------------------------------------------------------
     3. Accessibility controls (contrast / text size / dark mode)
  ----------------------------------------------------------- */
  function initAccessibilityControls() {
    const html = document.documentElement;

    // Restore saved preferences
    const savedContrast = sessionStorage.getItem("ht_contrast") === "1";
    const savedDark = sessionStorage.getItem("ht_dark") === "1";
    const savedScale = sessionStorage.getItem("ht_scale") || "md";

    if (savedContrast) html.classList.add("high-contrast");
    if (savedDark) html.classList.add("dark");
    applyTextScale(savedScale);

    syncToggleStates();

    $("#contrastBtn").addEventListener("click", () => {
      html.classList.toggle("high-contrast");
      sessionStorage.setItem("ht_contrast", html.classList.contains("high-contrast") ? "1" : "0");
      syncToggleStates();
    });

    $("#darkModeBtn").addEventListener("click", () => {
      html.classList.toggle("dark");
      sessionStorage.setItem("ht_dark", html.classList.contains("dark") ? "1" : "0");
      syncToggleStates();
    });

    // Text size cycles: md -> lg -> xl -> md
    $("#textSizeBtn").addEventListener("click", () => {
      const order = ["md", "lg", "xl"];
      const current = html.dataset.textScale || "md";
      const next = order[(order.indexOf(current) + 1) % order.length];
      applyTextScale(next);
      sessionStorage.setItem("ht_scale", next);
      syncToggleStates();
      const labels = { md: "Normal", lg: "Besar", xl: "Sangat Besar" };
      showToast("Ukuran teks: " + labels[next]);
    });

    // Settings page toggles mirror the topbar controls
    $("#settingsDarkToggle").addEventListener("click", () => $("#darkModeBtn").click());
    $("#settingsContrastToggle").addEventListener("click", () => $("#contrastBtn").click());
    $$("#page-settings [data-size]").forEach((btn) => {
      btn.addEventListener("click", () => {
        applyTextScale(btn.dataset.size);
        sessionStorage.setItem("ht_scale", btn.dataset.size);
        syncToggleStates();
      });
    });

    function applyTextScale(scale) {
      html.dataset.textScale = scale;
    }

    function syncToggleStates() {
      const isDark = html.classList.contains("dark");
      const isContrast = html.classList.contains("high-contrast");
      const scale = html.dataset.textScale || "md";

      $("#darkModeBtn").classList.toggle("is-on", isDark);
      $("#darkModeBtn").setAttribute("aria-pressed", String(isDark));
      $("#contrastBtn").classList.toggle("is-on", isContrast);
      $("#contrastBtn").setAttribute("aria-pressed", String(isContrast));

      $("#settingsDarkToggle").classList.toggle("on", isDark);
      $("#settingsDarkToggle").setAttribute("aria-checked", String(isDark));
      $("#settingsContrastToggle").classList.toggle("on", isContrast);
      $("#settingsContrastToggle").setAttribute("aria-checked", String(isContrast));

      $$("#page-settings [data-size]").forEach((b) => {
        b.classList.toggle("active", b.dataset.size === scale);
      });
    }
  }

  /* -----------------------------------------------------------
     4. Dashboard: dynamic history + Aura quick actions
  ----------------------------------------------------------- */
  const sessionHistory = []; // { title, snippet, tags: [], time, kind: 'stt'|'tts' }

  function renderHistory() {
    const list = $("#historyList");
    if (!list) return;

    if (sessionHistory.length === 0) {
      list.innerHTML = `<div class="history-empty">Belum ada aktivitas pada sesi tamu ini. Mulai dengan Live STT atau Message TTS.</div>`;
      return;
    }

    list.innerHTML = sessionHistory
      .slice(0, 6)
      .map((item) => {
        const iconClass = item.kind === "stt" ? "work" : "personal";
        const icon = item.kind === "stt" ? "description" : "forum";
        return `
        <div class="history-item">
          <div class="history-icon ${iconClass}"><span class="material-symbols-outlined">${icon}</span></div>
          <div class="history-body">
            <div class="history-top">
              <h5>${escapeHtml(item.title)}</h5>
              <span class="history-time">${escapeHtml(item.time)}</span>
            </div>
            <p class="history-snippet">"${escapeHtml(item.snippet)}"</p>
            <div class="history-tags">
              ${item.tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("")}
            </div>
          </div>
        </div>`;
      })
      .join("");
  }

  function addHistoryEntry(entry) {
    sessionHistory.unshift(entry);
    renderHistory();
  }

  function initGreeting() {
    const hour = new Date().getHours();
    let greeting = "Selamat Malam";
    if (hour < 11) greeting = "Selamat Pagi";
    else if (hour < 15) greeting = "Selamat Siang";
    else if (hour < 18) greeting = "Selamat Sore";
    $("#greetingText").textContent = `${greeting}, Tamu`;
  }

  function initAuraWidget() {
    const input = $("#auraInput");
    const micBtn = $("#auraMicBtn");

    function handleAuraQuery(text) {
      if (!text.trim()) return;
      showToast('Aura: "' + text + '" — fitur asisten penuh akan segera hadir.');
      input.value = "";
    }

    input.addEventListener("keypress", (e) => {
      if (e.key === "Enter") handleAuraQuery(input.value);
    });

    $$("[data-aura-q]").forEach((btn) => {
      btn.addEventListener("click", () => handleAuraQuery(btn.dataset.auraQ));
    });

    micBtn.addEventListener("click", () => {
      if (!SpeechAPI.recognitionSupported) {
        showToast("Pengenalan suara tidak didukung di browser ini.", true);
        return;
      }
      showToast("Silakan gunakan halaman Live STT untuk dikte suara penuh.");
    });
  }

  function initStatusChip() {
    setTimeout(() => $("#statusChip").classList.add("is-visible"), 1500);
    setTimeout(() => $("#statusChip").classList.remove("is-visible"), 6000);
  }

  /* -----------------------------------------------------------
     5. Web Speech API feature detection
  ----------------------------------------------------------- */
  const SpeechAPI = {
    SpeechRecognition: window.SpeechRecognition || window.webkitSpeechRecognition || null,
    get recognitionSupported() {
      return !!this.SpeechRecognition;
    },
    get synthesisSupported() {
      return "speechSynthesis" in window;
    },
  };

  /* -----------------------------------------------------------
     6. Live STT — real SpeechRecognition implementation
  ----------------------------------------------------------- */
const STT = {
  recognition: null,
  isListening: false,
  isStarting: false,
  isStopping: false,
  finalText: "",
  lang: "id-ID",
  currentRowEl: null,
  lastToggleAt: 0,
  startTimeoutId: null,    // NEW

  toggle() {
    const now = Date.now();
    if (now - this.lastToggleAt < 400) return;
    this.lastToggleAt = now;

    if (this.isListening) this.stop();
    else this.start();
  },

  start() {
    if (!this.recognition) return;
    if (this.isListening || this.isStarting) return;
    this.isStarting = true;

    try {
      this.recognition.start();
    } catch (err) {
      this.isStarting = false;
      return;
    }

    // NEW: failsafe — kalau onstart tidak terpicu dalam 3 detik
    // (mic permission stuck, engine gagal diam-diam, dll), reset flag
    // supaya tombol tidak permanen mati.
    clearTimeout(this.startTimeoutId);
    this.startTimeoutId = setTimeout(() => {
      if (this.isStarting && !this.isListening) {
        this.isStarting = false;
        showToast("Mikrofon tidak merespons. Coba tekan lagi.", true);
      }
    }, 3000);
  },

  stop() {
    if (!this.recognition) return;
    this.isStopping = true;
    this.recognition.stop();
  },

  handleStart() {
    clearTimeout(this.startTimeoutId);   // NEW
    this.isListening = true;
    this.isStarting = false;
    // ...sisanya tetap sama
  },

  handleEnd() {
    clearTimeout(this.startTimeoutId);   // NEW
    this.isListening = false;
    this.isStarting = false;
    this.isStopping = false;
    // ...sisanya tetap sama
  },

  handleError(event) {
    clearTimeout(this.startTimeoutId);   // NEW
    this.isStarting = false;             // NEW — penting! error juga harus reset flag
    this.isStopping = false;             // NEW

    let msg = "Terjadi kesalahan pengenalan suara.";
    if (event.error === "not-allowed" || event.error === "permission-denied") {
      msg = "Izin mikrofon ditolak. Aktifkan akses mikrofon di pengaturan browser.";
    } else if (event.error === "no-speech") {
      return;
    } else if (event.error === "network") {
      msg = "Masalah jaringan saat memproses suara.";
    }
    showToast(msg, true);
  },

    handleResult(event) {
      const scroll = $("#transcriptScroll");
      let interim = "";
      let finalChunk = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalChunk += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }

      if (finalChunk) {
        this.finalText += (this.finalText ? " " : "") + finalChunk.trim();
        this.appendFinalRow(finalChunk.trim());
        this.currentRowEl = null;
      }

      if (interim) {
        this.renderInterim(interim);
      }

      scroll.scrollTop = scroll.scrollHeight;
    },

    appendFinalRow(text) {
      const scroll = $("#transcriptScroll");
      const time = new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
      const row = document.createElement("div");
      row.className = "transcript-row";
      row.innerHTML = `
        <div class="transcript-avatar"><span class="material-symbols-outlined">person</span></div>
        <div>
          <p class="transcript-meta">PEMBICARA • ${time}</p>
          <p class="transcript-text">${escapeHtml(text)}</p>
        </div>`;
      scroll.appendChild(row);
    },

    renderInterim(text) {
      const scroll = $("#transcriptScroll");
      if (!this.currentRowEl) {
        const row = document.createElement("div");
        row.className = "transcript-row";
        row.innerHTML = `
          <div class="transcript-avatar"><span class="material-symbols-outlined">graphic_eq</span></div>
          <div>
            <p class="transcript-meta">MENDENGARKAN...</p>
            <p class="transcript-text interim"></p>
          </div>`;
        scroll.appendChild(row);
        this.currentRowEl = row;
      }
      this.currentRowEl.querySelector(".transcript-text").textContent = text;
    },

    clear() {
      this.finalText = "";
      this.currentRowEl = null;
      $("#transcriptScroll").innerHTML = `
        <div class="transcript-empty" id="transcriptEmptyState">
          <span class="material-symbols-outlined">graphic_eq</span>
          <p>Tekan tombol mikrofon untuk mulai mentranskripsikan ucapan Anda secara langsung.</p>
        </div>`;
      $("#sttCopyBtn").disabled = true;
      $("#sttDownloadBtn").disabled = true;
    },

    copy() {
      if (!this.finalText.trim()) return;
      navigator.clipboard
        .writeText(this.finalText)
        .then(() => showToast("Transkrip disalin ke clipboard."))
        .catch(() => showToast("Gagal menyalin teks.", true));
    },

    download() {
      if (!this.finalText.trim()) return;
      downloadTextFile(`transkrip-heartext-${Date.now()}.txt`, this.finalText);
      addHistoryEntry({
        title: "Transkripsi Live STT",
        snippet: this.finalText.slice(0, 80),
        tags: ["STT", this.lang === "id-ID" ? "Indonesia" : "English"],
        time: "Baru saja",
        kind: "stt",
      });
      showToast("Transkrip diunduh.");
    },

    share() {
      if (!this.finalText.trim()) {
        showToast("Belum ada teks untuk dibagikan.", true);
        return;
      }
      if (navigator.share) {
        navigator.share({ title: "Transkrip HearText AI", text: this.finalText }).catch(() => {});
      } else {
        this.copy();
        showToast("Tautan berbagi tidak didukung — teks disalin sebagai gantinya.");
      }
    },
  };

  /* -----------------------------------------------------------
     7. Message TTS — real SpeechSynthesis implementation
  ----------------------------------------------------------- */
  const TTS = {
    voices: [],
    recentList: [],

    init() {
      const warning = $("#ttsUnsupportedWarning");
      if (!SpeechAPI.synthesisSupported) {
        warning.style.display = "flex";
        $("#ttsSpeakBtn").disabled = true;
        return;
      }

      this.loadVoices();
      if ("onvoiceschanged" in window.speechSynthesis) {
        window.speechSynthesis.onvoiceschanged = () => this.loadVoices();
      }

      const input = $("#ttsInput");
      const charCount = $("#ttsCharCount");

      input.addEventListener("input", () => {
        const len = input.value.length;
        charCount.textContent = `${len} / 500`;
        charCount.classList.toggle("limit", len > 450);
      });

      $("#ttsSpeakBtn").addEventListener("click", () => this.speak());
      $("#ttsStopBtn").addEventListener("click", () => this.cancel());
      $("#ttsClearBtn").addEventListener("click", () => {
        input.value = "";
        input.dispatchEvent(new Event("input"));
      });

      $$(".phrase-chip").forEach((chip) => {
        chip.addEventListener("click", () => {
          input.value = chip.dataset.phrase;
          input.dispatchEvent(new Event("input"));
          input.focus();
        });
      });

      $("#speedSlider").addEventListener("input", (e) => {
        $("#speedVal").textContent = parseFloat(e.target.value).toFixed(1) + "x";
      });

      $("#pitchSlider").addEventListener("input", (e) => {
        const val = parseFloat(e.target.value);
        let label = "Natural";
        if (val < 0.9) label = "Dalam";
        else if (val > 1.1) label = "Tinggi";
        $("#pitchVal").textContent = label;
      });
    },

    loadVoices() {
      this.voices = window.speechSynthesis.getVoices();
      const select = $("#voiceSelect");
      if (!select) return;

      if (this.voices.length === 0) {
        select.innerHTML = `<option>Memuat suara...</option>`;
        return;
      }

      // Prefer Indonesian voices first, then list the rest
      const sorted = [...this.voices].sort((a, b) => {
        const aId = a.lang.toLowerCase().startsWith("id") ? 0 : 1;
        const bId = b.lang.toLowerCase().startsWith("id") ? 0 : 1;
        return aId - bId;
      });

      select.innerHTML = sorted
        .map((v, i) => `<option value="${this.voices.indexOf(v)}">${escapeHtml(v.name)} (${v.lang})</option>`)
        .join("");
    },

    speak() {
      const text = $("#ttsInput").value.trim();
      const input = $("#ttsInput");

      if (!text) {
        input.classList.add("invalid");
        setTimeout(() => input.classList.remove("invalid"), 900);
        return;
      }

      this.cancel(); // stop anything currently speaking

      const utterance = new SpeechSynthesisUtterance(text);
      const voiceIndex = $("#voiceSelect").value;
      if (voiceIndex !== "" && this.voices[voiceIndex]) {
        utterance.voice = this.voices[voiceIndex];
        utterance.lang = this.voices[voiceIndex].lang;
      }
      utterance.rate = parseFloat($("#speedSlider").value);
      utterance.pitch = parseFloat($("#pitchSlider").value);

      utterance.onstart = () => {
        $("#ttsSpeakingIndicator").classList.add("is-active");
        $("#ttsSpeakBtn").disabled = true;
        $("#ttsStopBtn").style.display = "flex";
      };
      utterance.onend = () => {
        this.onSpeechFinished(text);
      };
      utterance.onerror = () => {
        this.onSpeechFinished(text);
        showToast("Terjadi kesalahan saat mengucapkan teks.", true);
      };

      window.speechSynthesis.speak(utterance);
    },

    onSpeechFinished(text) {
      $("#ttsSpeakingIndicator").classList.remove("is-active");
      $("#ttsSpeakBtn").disabled = false;
      $("#ttsStopBtn").style.display = "none";
      this.addRecent(text);
    },

    cancel() {
      if (SpeechAPI.synthesisSupported && window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel();
      }
      $("#ttsSpeakingIndicator").classList.remove("is-active");
      $("#ttsSpeakBtn").disabled = false;
      $("#ttsStopBtn").style.display = "none";
    },

    addRecent(text) {
      this.recentList.unshift({ text, time: "Baru saja" });
      this.recentList = this.recentList.slice(0, 5);
      this.renderRecent();

      addHistoryEntry({
        title: "Pesan Suara",
        snippet: text.slice(0, 80),
        tags: ["TTS"],
        time: "Baru saja",
        kind: "tts",
      });
    },

    renderRecent() {
      const list = $("#recentSpokenList");
      if (this.recentList.length === 0) {
        list.innerHTML = `<p class="recent-empty">Belum ada riwayat pada sesi ini.</p>`;
        return;
      }
      list.innerHTML = this.recentList
        .map(
          (item, i) => `
        <div class="recent-item ${i === 0 ? "" : "faded"}">
          <p>"${escapeHtml(item.text)}"</p>
          <span>${escapeHtml(item.time)}</span>
        </div>`
        )
        .join("");
    },
  };

  /* -----------------------------------------------------------
     8. Support AI — chat widget (rule-based demo assistant)
  ----------------------------------------------------------- */
  const SupportChat = {
    init() {
      $("#chatSendBtn").addEventListener("click", () => this.send());
      $("#chatInput").addEventListener("keypress", (e) => {
        if (e.key === "Enter") this.send();
      });
      $$(".chat-suggest-btn").forEach((btn) => {
        btn.addEventListener("click", () => this.send(btn.dataset.q));
      });

      $("#feedbackYes").addEventListener("click", () => this.setFeedback("yes"));
      $("#feedbackNo").addEventListener("click", () => this.setFeedback("no"));
    },

    send(presetText) {
      const input = $("#chatInput");
      const text = (presetText || input.value).trim();
      if (!text) return;

      this.appendMessage(text, true);
      input.value = "";

      // remove suggestion chips after first real interaction
      const suggestions = $(".chat-suggestions");
      if (suggestions) suggestions.remove();

      this.showTyping();
      setTimeout(() => {
        this.hideTyping();
        this.appendMessage(this.generateReply(text), false);
      }, 700 + Math.random() * 500);
    },

    appendMessage(text, isUser) {
      const container = $("#chatMessages");
      const row = document.createElement("div");
      row.className = "chat-bubble-row" + (isUser ? " user" : "");
      row.innerHTML = `
        <div class="chat-bubble ${isUser ? "user" : "bot"}">${escapeHtml(text)}</div>
        <span class="chat-meta">${isUser ? "Anda" : "Asisten"} • Baru saja</span>`;
      container.appendChild(row);
      container.scrollTop = container.scrollHeight;
    },

    showTyping() {
      const container = $("#chatMessages");
      const typing = document.createElement("div");
      typing.className = "chat-bubble-row";
      typing.id = "typingIndicatorRow";
      typing.innerHTML = `<div class="chat-bubble bot chat-typing"><span></span><span></span><span></span></div>`;
      container.appendChild(typing);
      container.scrollTop = container.scrollHeight;
    },

    hideTyping() {
      const row = $("#typingIndicatorRow");
      if (row) row.remove();
    },

    generateReply(userText) {
      const t = userText.toLowerCase();
      if (t.includes("ekspor") || t.includes("export") || t.includes("unduh") || t.includes("download")) {
        return "Untuk mengekspor transkrip: di halaman Live STT, tekan 'Unduh Transkripsi' setelah berhenti mendengarkan. Format yang tersedia adalah .TXT.";
      }
      if (t.includes("mikrofon") || t.includes("mic")) {
        return "Pastikan browser memiliki izin mikrofon (lihat ikon gembok di address bar) dan tidak ada aplikasi lain yang sedang memakainya.";
      }
      if (t.includes("font") || t.includes("ukuran teks") || t.includes("text size")) {
        return "Anda dapat mengubah ukuran teks lewat ikon 'format_size' di bagian atas, atau buka halaman Pengaturan untuk pilihan lebih lengkap.";
      }
      if (t.includes("suara") || t.includes("voice") || t.includes("tts")) {
        return "Di halaman Message TTS, Anda bisa memilih suara dari daftar 'Suara' serta mengatur kecepatan dan nada sesuai preferensi.";
      }
      if (t.includes("bahasa") || t.includes("language")) {
        return "Live STT mendukung Bahasa Indonesia dan English. Beralih bahasa lewat tombol di pojok kanan atas halaman Live STT.";
      }
      return "Terima kasih atas pertanyaannya! Tim kami akan terus melengkapi panduan ini. Untuk bantuan mendalam, jelajahi panduan di atas atau coba kata kunci lain seperti 'ekspor', 'mikrofon', atau 'suara'.";
    },

    setFeedback(value) {
      $("#feedbackYes").classList.toggle("selected", value === "yes");
      $("#feedbackNo").classList.toggle("selected", value === "no");
      showToast(value === "yes" ? "Terima kasih atas masukan positif Anda!" : "Terima kasih, kami akan terus memperbaiki.");
    },
  };

  /* -----------------------------------------------------------
     9. Settings page — default STT language picker
  ----------------------------------------------------------- */
  function initSettingsPage() {
    $$("#page-settings [data-default-lang]").forEach((btn) => {
      btn.addEventListener("click", () => {
        $$("#page-settings [data-default-lang]").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        STT.lang = btn.dataset.defaultLang;
        if (STT.recognition) STT.recognition.lang = STT.lang;

        // keep the STT page toggle in sync
        $$(".lang-toggle [data-lang]").forEach((b) => {
          b.classList.toggle("active", b.dataset.lang === STT.lang);
        });
        showToast("Bahasa pengenalan suara default diperbarui.");
      });
    });
  }

  /* -----------------------------------------------------------
     10. New Transcription shortcut
  ----------------------------------------------------------- */
  function initNewTranscriptionShortcut() {
    $("#newTranscriptionBtn").addEventListener("click", () => {
      navigateTo("stt");
      setTimeout(() => {
        if (!STT.isListening) STT.start();
      }, 200);
    });
  }

  /* -----------------------------------------------------------
     11. Boot
  ----------------------------------------------------------- */
  document.addEventListener("DOMContentLoaded", () => {
    initGreeting();
    initRouter();
    initMobileNav();
    initAccessibilityControls();
    initAuraWidget();
    initStatusChip();
    initNewTranscriptionShortcut();
    initSettingsPage();

    STT.init();
    TTS.init();
    SupportChat.init();

    renderHistory();
  });
})();
