/**
 * Shilpi — public chat widget. Self-contained: injects its own markup,
 * styles, and behavior. Include with a single <script src="shilpi-widget.js" defer></script>
 * on any page. Talks to /api/chat (Node function, Claude-backed).
 *
 * Voice replies use the browser's built-in SpeechSynthesis API (free,
 * zero backend) — quality and language coverage (especially Odia) vary a
 * lot by browser/OS and can't be guaranteed consistent.
 */
(function () {
  "use strict";

  // Update this one line to swap in a dedicated business number later —
  // nothing else needs to change. Deliberately never printed as visible
  // text anywhere; only embedded in the wa.me link's destination (visitors
  // see it only once they actually open WhatsApp, same as any "Message
  // us" button on any site).
  const WHATSAPP_NUMBER = "917855012176";

  const STYLE = `
    #shilpi-launcher {
      position: fixed; bottom: 22px; right: 22px; z-index: 9999;
      width: 60px; height: 60px; border-radius: 50%; border: none; cursor: pointer;
      background: linear-gradient(135deg, #6366F1, #A78BFA);
      box-shadow: 0 10px 30px -8px rgba(99,102,241,0.7);
      display: flex; align-items: center; justify-content: center;
      padding: 0; overflow: hidden; transition: transform .2s ease;
    }
    #shilpi-launcher:hover { transform: scale(1.06); }
    #shilpi-launcher img { width: 100%; height: 100%; object-fit: cover; display: block; }
    #shilpi-panel {
      position: fixed; bottom: 96px; right: 22px; z-index: 9999;
      width: min(360px, calc(100vw - 32px)); height: min(520px, calc(100vh - 140px));
      background: #0E1320; border: 1px solid rgba(255,255,255,0.09); border-radius: 18px;
      box-shadow: 0 24px 60px -12px rgba(0,0,0,0.6);
      display: none; flex-direction: column; overflow: hidden;
      font-family: 'Inter', sans-serif; color: #E7EAF2;
    }
    #shilpi-panel.open { display: flex; }
    #shilpi-header {
      display: flex; align-items: center; gap: 10px; padding: 14px 16px;
      border-bottom: 1px solid rgba(255,255,255,0.09); background: rgba(255,255,255,0.02);
    }
    #shilpi-header img { width: 36px; height: 36px; border-radius: 50%; object-fit: cover; }
    #shilpi-header .info { flex: 1; }
    #shilpi-header .name { font-family: 'Space Grotesk', sans-serif; font-weight: 600; font-size: 14px; }
    #shilpi-header .sub { font-size: 11px; color: #99A2B8; }
    #shilpi-close, #shilpi-voice-toggle {
      background: none; border: none; color: #99A2B8; cursor: pointer; font-size: 16px; padding: 4px;
    }
    #shilpi-voice-toggle.active { color: #818CF8; }
    #shilpi-messages { flex: 1; overflow-y: auto; padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; }
    .shilpi-msg { max-width: 82%; padding: 9px 13px; border-radius: 14px; font-size: 13.5px; line-height: 1.45; white-space: pre-wrap; }
    .shilpi-msg.user { align-self: flex-end; background: #6366F1; color: #fff; border-bottom-right-radius: 4px; }
    .shilpi-msg.bot { align-self: flex-start; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); border-bottom-left-radius: 4px; }
    .shilpi-msg.typing { align-self: flex-start; color: #99A2B8; font-style: italic; }
    #shilpi-inputrow { display: flex; gap: 8px; padding: 12px; border-top: 1px solid rgba(255,255,255,0.09); }
    #shilpi-input {
      flex: 1; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.09);
      border-radius: 10px; padding: 9px 12px; color: #E7EAF2; font-size: 13.5px; font-family: inherit; resize: none;
    }
    #shilpi-input:focus { outline: none; border-color: rgba(129,140,248,0.5); }
    #shilpi-send {
      background: #6366F1; color: #fff; border: none; border-radius: 10px; padding: 0 16px;
      font-weight: 600; font-size: 13px; cursor: pointer;
    }
    #shilpi-send:disabled { opacity: 0.5; cursor: default; }
    #shilpi-whatsapp {
      display: block; text-align: center; font-size: 11.5px; color: #34D399;
      padding: 7px 12px; text-decoration: none; border-top: 1px solid rgba(255,255,255,0.06);
    }
    #shilpi-whatsapp:hover { text-decoration: underline; }
  `;

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, "");
    return "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function getSessionId() {
    try {
      let id = localStorage.getItem("shilpi_session_id");
      if (!id) {
        id = uid();
        localStorage.setItem("shilpi_session_id", id);
      }
      return id;
    } catch {
      return uid(); // storage unavailable — non-persistent fallback
    }
  }

  function init() {
    const styleEl = document.createElement("style");
    styleEl.textContent = STYLE;
    document.head.appendChild(styleEl);

    const launcher = document.createElement("button");
    launcher.id = "shilpi-launcher";
    launcher.setAttribute("aria-label", "Chat with Shilpi");
    launcher.innerHTML = `<img src="/shilpi-avatar.jpg" alt="Shilpi">`;
    document.body.appendChild(launcher);

    const panel = document.createElement("div");
    panel.id = "shilpi-panel";
    panel.innerHTML = `
      <div id="shilpi-header">
        <img src="/shilpi-avatar.jpg" alt="Shilpi">
        <div class="info">
          <div class="name">Shilpi</div>
          <div class="sub">Dreviq Studio · usually replies instantly</div>
        </div>
        <button id="shilpi-voice-toggle" title="Toggle voice replies" aria-label="Toggle voice replies">🔊</button>
        <button id="shilpi-close" aria-label="Close chat">✕</button>
      </div>
      <div id="shilpi-messages"></div>
      <a id="shilpi-whatsapp" target="_blank" rel="noopener">💬 Prefer WhatsApp? Continue there instead</a>
      <div id="shilpi-inputrow">
        <textarea id="shilpi-input" rows="1" placeholder="Ask about services, pricing, anything..."></textarea>
        <button id="shilpi-send">Send</button>
      </div>
    `;
    document.body.appendChild(panel);

    const messagesEl = panel.querySelector("#shilpi-messages");
    const inputEl = panel.querySelector("#shilpi-input");
    const sendBtn = panel.querySelector("#shilpi-send");
    const closeBtn = panel.querySelector("#shilpi-close");
    const voiceBtn = panel.querySelector("#shilpi-voice-toggle");
    const whatsappLink = panel.querySelector("#shilpi-whatsapp");
    whatsappLink.href =
      "https://wa.me/" +
      WHATSAPP_NUMBER +
      "?text=" +
      encodeURIComponent("Hi, I was chatting with Shilpi on dreviqstudio.com and wanted to continue here.");

    let voiceOn = false;
    let opened = false;
    const sessionId = getSessionId();

    function addMessage(role, text) {
      const el = document.createElement("div");
      el.className = "shilpi-msg " + (role === "user" ? "user" : "bot");
      el.textContent = text;
      messagesEl.appendChild(el);
      messagesEl.scrollTop = messagesEl.scrollHeight;
      return el;
    }

    function speak(text) {
      if (!voiceOn || !window.speechSynthesis) return;
      try {
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(text);
        window.speechSynthesis.speak(utter);
      } catch {
        /* speech synthesis unsupported/blocked — silently skip */
      }
    }

    voiceBtn.addEventListener("click", () => {
      voiceOn = !voiceOn;
      voiceBtn.classList.toggle("active", voiceOn);
      if (!voiceOn && window.speechSynthesis) window.speechSynthesis.cancel();
    });

    async function sendMessage() {
      const text = inputEl.value.trim();
      if (!text) return;
      inputEl.value = "";
      sendBtn.disabled = true;
      addMessage("user", text);

      const typingEl = document.createElement("div");
      typingEl.className = "shilpi-msg bot typing";
      typingEl.textContent = "Shilpi is typing...";
      messagesEl.appendChild(typingEl);
      messagesEl.scrollTop = messagesEl.scrollHeight;

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, message: text }),
        });
        const data = await res.json();
        typingEl.remove();
        if (!res.ok) {
          addMessage("bot", data.error || "Something went wrong — please try again.");
        } else {
          addMessage("bot", data.reply);
          speak(data.reply);
        }
      } catch {
        typingEl.remove();
        addMessage("bot", "Network error — please try again.");
      } finally {
        sendBtn.disabled = false;
        inputEl.focus();
      }
    }

    sendBtn.addEventListener("click", sendMessage);
    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    launcher.addEventListener("click", () => {
      opened = !opened;
      panel.classList.toggle("open", opened);
      if (opened && messagesEl.children.length === 0) {
        addMessage(
          "bot",
          "Hi! I'm Shilpi from Dreviq Studio 👋 I can walk you through our services, pricing, or help scope your project — English, Hindi, or Odia, whatever's easiest for you."
        );
      }
      if (opened) inputEl.focus();
    });
    closeBtn.addEventListener("click", () => {
      opened = false;
      panel.classList.remove("open");
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
