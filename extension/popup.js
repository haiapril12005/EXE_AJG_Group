const APP_URL = "http://localhost:3000/";
const DRAFT_KEY = "cvfit.jd-draft";
const JD_MIN_LENGTH = 50;

const button = document.getElementById("send");
const status = document.getElementById("status");

function waitUntilLoaded(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.onUpdated.addListener(function listener(id, change) {
      if (id !== tabId || change.status !== "complete") return;
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    });
  });
}

async function readJobText(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, files: ["extract.js"] });
  return result ?? "";
}

async function sendJob() {
  button.disabled = true;
  status.textContent = "";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const text = await readJobText(tab.id);
    if (text.length < JD_MIN_LENGTH) {
      status.textContent = "Không đọc được JD trên trang này. Hãy bôi đen phần mô tả công việc rồi thử lại.";
      return;
    }
    // Opening the tab in the background keeps this popup alive until the JD is handed over.
    const appTab = await chrome.tabs.create({ url: APP_URL, active: false });
    await waitUntilLoaded(appTab.id);
    await chrome.scripting.executeScript({
      target: { tabId: appTab.id },
      args: [DRAFT_KEY, { text }],
      func: (key, draft) => {
        sessionStorage.setItem(key, JSON.stringify(draft));
        location.reload();
      }
    });
    await chrome.tabs.update(appTab.id, { active: true });
  } catch {
    status.textContent = "Không gửi được JD. Hãy kiểm tra ứng dụng đang chạy ở localhost:3000 và trang hiện tại không phải trang hệ thống của trình duyệt.";
  } finally {
    button.disabled = false;
  }
}

button.addEventListener("click", () => void sendJob());
