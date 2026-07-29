// Gemini API 키는 이 브라우저의 localStorage에만 저장된다 — 소스코드/저장소/서버
// 어디에도 남지 않는다. 각자 자신의 키를 채팅창에서 한 번 입력하면 된다.
const GEMINI_KEY_STORAGE = "dashboard-gemini-api-key";
const GEMINI_MODEL = "gemini-flash-latest";
const GEMINI_KEY_HELP_URL = "https://aistudio.google.com/app/apikey";

const CHAT_SYSTEM_PROMPT = `당신은 사용자가 지금 보고 있는 금융 시황 대시보드 차트를 근거로 답하는 어시스턴트입니다.
요청에 함께 전달되는 JSON은 사용자가 현재 화면에서 보고 있는 데이터
(선택한 지표, 화면에 표시된 기간, 표시 중인 이동평균선, 사용자가 직접 찍어둔 비교 포인트와
그 포인트들 간의 기간·등락률)입니다.

- 반드시 이 데이터를 근거로 답변하세요.
- 데이터에 없는 사실(예: 최신 뉴스, 실시간 시세, 이 JSON에 없는 종목)은 추측하지 말고
  "현재 화면 데이터에는 없는 정보"라고 명확히 밝히세요.
- 투자 자문이 아니라 데이터 해설로서 답하고, 확정적 투자 조언(매수/매도 권유)은 피하세요.
- 한국어로, 간결하게 답하세요.`;

function getStoredKey() {
  return localStorage.getItem(GEMINI_KEY_STORAGE) || "";
}
function setStoredKey(key) {
  localStorage.setItem(GEMINI_KEY_STORAGE, key);
}
function clearStoredKey() {
  localStorage.removeItem(GEMINI_KEY_STORAGE);
}

async function callGemini(apiKey, message, context) {
  const safeMessage = String(message).slice(0, 2000);
  const safeContext = JSON.stringify(context || {}).slice(0, 8000);

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: CHAT_SYSTEM_PROMPT }] },
        contents: [
          {
            role: "user",
            parts: [{ text: `현재 화면 데이터(JSON):\n${safeContext}\n\n사용자 질문:\n${safeMessage}` }],
          },
        ],
        generationConfig: { maxOutputTokens: 1024, temperature: 0.4 },
      }),
    }
  );

  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data?.error?.message || `Gemini API 오류 (${res.status})`);
    err.status = res.status;
    throw err;
  }
  const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
  return text || "(응답이 비어있습니다)";
}

(function () {
  const fab = document.getElementById("chat-fab");
  const panel = document.getElementById("chat-panel");
  const closeBtn = document.getElementById("chat-close");
  const messagesEl = document.getElementById("chat-messages");
  const form = document.getElementById("chat-form");
  const input = document.getElementById("chat-input");

  function appendMessage(role, text, extraClass) {
    const div = document.createElement("div");
    div.className = `chat-msg ${role}${extraClass ? " " + extraClass : ""}`;
    div.textContent = text;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  function isKeyMode() {
    return !getStoredKey();
  }

  function refreshInputMode() {
    if (isKeyMode()) {
      input.placeholder = "Gemini API 키를 붙여넣으세요";
      input.type = "password";
    } else {
      input.placeholder = '예: 두 지수 언제부터 벌어졌어? ("키변경"으로 키 재설정)';
      input.type = "text";
    }
  }

  function openPanel() {
    panel.hidden = false;
    fab.hidden = true;
    refreshInputMode();
    input.focus();
    if (!messagesEl.children.length) {
      if (isKeyMode()) {
        appendMessage(
          "assistant",
          `채팅을 쓰려면 Gemini API 키가 필요해요. 이 키는 이 브라우저에만 저장되고 서버/저장소 어디에도 남지 않아요.\n\n무료 발급: ${GEMINI_KEY_HELP_URL}\n\n발급받은 키를 아래 입력창에 붙여넣어주세요.`
        );
      } else {
        appendMessage(
          "assistant",
          '안녕하세요! 지금 화면에 선택된 지표·구간·이동평균·찍어둔 포인트를 보고 답해드려요.\n예: "두 지수 언제부터 벌어졌어?", "찍은 포인트들 중에 제일 많이 오른 구간은?"'
        );
      }
    }
  }

  function closePanel() {
    panel.hidden = true;
    fab.hidden = false;
  }

  fab.addEventListener("click", openPanel);
  closeBtn.addEventListener("click", closePanel);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const value = input.value.trim();
    if (!value) return;
    input.value = "";

    if (isKeyMode()) {
      setStoredKey(value);
      refreshInputMode();
      appendMessage("assistant", '키를 저장했어요! 이제 질문해보세요. (다른 키로 바꾸려면 "키변경"이라고 입력하세요)');
      return;
    }

    if (value === "키변경" || value === "키 변경") {
      clearStoredKey();
      refreshInputMode();
      appendMessage(
        "assistant",
        `키를 지웠어요. 새 Gemini API 키를 붙여넣어주세요.\n무료 발급: ${GEMINI_KEY_HELP_URL}`
      );
      return;
    }

    appendMessage("user", value);
    const loadingEl = appendMessage("assistant", "생각 중…", "loading");

    let context = {};
    try {
      context = typeof DashboardChart !== "undefined" ? DashboardChart.getContext() : {};
    } catch (err) {
      console.error("컨텍스트 수집 실패:", err);
    }

    try {
      const answer = await callGemini(getStoredKey(), value, context);
      loadingEl.textContent = answer;
      loadingEl.classList.remove("loading");
    } catch (err) {
      if (err.status === 400 || err.status === 401 || err.status === 403) {
        clearStoredKey();
        refreshInputMode();
        loadingEl.textContent = `키가 유효하지 않은 것 같아요(${err.message}). 키를 지웠으니 다시 입력해주세요.`;
      } else {
        loadingEl.textContent = `오류가 발생했어요: ${err.message}`;
      }
      loadingEl.classList.remove("loading");
      loadingEl.classList.add("error");
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
  });
})();
