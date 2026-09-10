const chatMessages = document.getElementById('chatMessages');
const welcomeState = document.getElementById('welcomeState');
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');
const resetBtn = document.getElementById('resetBtn');
const typingIndicator = document.getElementById('typingIndicator');
const composerModelSelect = document.getElementById('composerModelSelect');
const effortSelect = document.getElementById('effortSelect');
const statusIndicator = document.getElementById('statusIndicator');
const statusText = document.getElementById('statusText');
const historyList = document.getElementById('historyList');
const historySearch = document.getElementById('historySearch');
const sidebar = document.getElementById('sidebar');
const mobileBackdrop = document.getElementById('mobileBackdrop');
const appShell = document.querySelector('.app-shell');
const aboutDialog = document.getElementById('aboutDialog');
const installButton = document.getElementById('installButton');
const quotaMeter = document.getElementById('quotaMeter');
const quotaLabel = document.getElementById('quotaLabel');
const thinkingText = document.getElementById('thinkingText');
const themeToggle = document.getElementById('themeToggle');
const shareButton = document.getElementById('shareButton');
const shareToast = document.getElementById('shareToast');
const STORAGE_KEY = 'noviq-ai-chats';
const DEVICE_KEY = 'noviq-ai-device-id';
const THEME_KEY = 'noviq-theme';
let conversations = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
let deviceId = localStorage.getItem(DEVICE_KEY);
let currentChat = null;
let deferredInstallPrompt = null;
let promptsUsed = Number(localStorage.getItem('noviq-prompts-used') || 0);
let quotaResetAt = localStorage.getItem('noviq-quota-reset-at') || '';
let pendingThinkingMessage = null;
let shareToastTimer = null;

function safeJsonParse(value, fallback) {
    try { return JSON.parse(value || 'null') ?? fallback; } catch { return fallback; }
}

function setTheme(theme) {
    const isDark = theme === 'dark';
    document.body.classList.toggle('dark-mode', isDark);
    localStorage.setItem(THEME_KEY, theme);
    if (themeToggle) {
        themeToggle.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
        themeToggle.title = isDark ? 'Switch to light mode' : 'Switch to dark mode';
        themeToggle.classList.toggle('is-dark', isDark);
    }
}

function normalizeSharedChat(chat) {
    if (!chat || !Array.isArray(chat.messages)) return null;
    return {
        id: chat.id || 'shared_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        title: String(chat.title || 'Shared conversation').trim() || 'Shared conversation',
        messages: chat.messages
            .filter(message => message && typeof message.text === 'string')
            .map(message => ({ text: message.text, sender: message.sender === 'user' ? 'user' : 'bot' }))
            .slice(-200)
    };
}

function readSharedChatFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const rawChat = params.get('chat') || params.get('share');
    if (!rawChat) return null;
    try {
        return normalizeSharedChat(JSON.parse(rawChat));
    } catch {
        return null;
    }
}

function buildShareUrl() {
    if (!currentChat || !currentChat.messages.length) return ''; 

    const url = new URL(window.location.href);
    url.searchParams.set('chat', JSON.stringify({
        id: currentChat.id,
        title: currentChat.title,
        messages: currentChat.messages.slice(-200)
    }));
    return url.toString();
}

if (quotaResetAt && Date.now() >= Date.parse(quotaResetAt)) { promptsUsed = 0; localStorage.removeItem('noviq-prompts-used'); localStorage.removeItem('noviq-quota-reset-at'); }
if (!deviceId) { deviceId = crypto.randomUUID ? crypto.randomUUID() : 'device_' + Date.now() + '_' + Math.random().toString(36).slice(2); localStorage.setItem(DEVICE_KEY, deviceId); }

function makeChat() { return { id: 'chat_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8), title: 'New conversation', messages: [] }; }
function saveChats() { localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations)); }
function currentSession() { return currentChat ? currentChat.id : ''; }
function requestHistory() {
    return (currentChat?.messages || []).slice(-40).map(message => ({
        role: message.sender === 'bot' ? 'model' : 'user',
        parts: [{ text: String(message.text || '') }]
    }));
}
function applyQuotaMeter() {
    if (!quotaMeter) return;

    const progress = Math.min((promptsUsed / 5) * 100, 100);
    quotaMeter.style.setProperty('--progress', `${progress}%`);
    quotaMeter.setAttribute('aria-label', `${Math.min(promptsUsed, 5)}/5 prompts used`);
    quotaMeter.title = `${Math.min(promptsUsed, 5)}/5 prompts used`;

    if (quotaLabel) {
        quotaLabel.textContent = promptsUsed >= 5 ? 'Daily limit reached' : `${Math.max(0, 5 - promptsUsed)} left today`;
    }
}

function updateQuota(quota) {
    if (!quota) return;
    promptsUsed = quota.used;
    quotaResetAt = quota.reset_at || '';
    localStorage.setItem('noviq-prompts-used', String(promptsUsed));
    localStorage.setItem('noviq-quota-reset-at', quotaResetAt);
    applyQuotaMeter();
}

function restoreQuota() {
    applyQuotaMeter();
    sendBtn.disabled = promptsUsed >= 5;
}

function renderHistory(filter = '') {
    historyList.innerHTML = '';
    const visible = conversations.filter(chat => chat.title.toLowerCase().includes(filter.toLowerCase()));
    if (!visible.length) { historyList.innerHTML = '<p class="history-empty">Your conversations will appear here.</p>'; return; }
    visible.forEach(chat => {
        const item = document.createElement('div'); item.className = 'history-item' + (currentChat?.id === chat.id ? ' active' : '');
        const openButton = document.createElement('button'); openButton.className = 'history-open'; openButton.innerHTML = '<span>◌</span><span></span>'; openButton.lastElementChild.textContent = chat.title; openButton.addEventListener('click', () => openChat(chat.id));
        const deleteButton = document.createElement('button'); deleteButton.className = 'history-delete'; deleteButton.type = 'button'; deleteButton.title = 'Delete conversation'; deleteButton.setAttribute('aria-label', `Delete ${chat.title}`); deleteButton.textContent = '×'; deleteButton.addEventListener('click', () => deleteChat(chat.id));
        item.append(openButton, deleteButton); historyList.appendChild(item);
    });
}

function renderMessages() {
    chatMessages.innerHTML = '';
    if (!currentChat || !currentChat.messages.length) { chatMessages.appendChild(welcomeState); welcomeState.style.display = ''; return; }
    currentChat.messages.forEach(message => addMessage(message.text, message.sender, false));
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function openChat(id) { currentChat = conversations.find(chat => chat.id === id) || null; renderMessages(); renderHistory(historySearch.value); closeSidebar(); }
function startNewChat() { currentChat = makeChat(); renderMessages(); renderHistory(); userInput.focus(); closeSidebar(); }

async function deleteChat(id) {
    const chat = conversations.find(item => item.id === id);
    if (!chat || !confirm(`Delete "${chat.title}"?`)) return;
    try { await fetch('/reset', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-ID': deviceId }, body: JSON.stringify({ session_id: id }) }); } catch { /* local deletion still works */ }
    conversations = conversations.filter(item => item.id !== id); saveChats();
    if (currentChat?.id === id) startNewChat(); else renderHistory(historySearch.value);
}

function addMessage(text, sender, scroll = true) {
    if (welcomeState.parentElement === chatMessages) welcomeState.remove();
    const messageDiv = document.createElement('div'); messageDiv.className = `message ${sender}`;
    const avatar = document.createElement('img'); avatar.className = 'avatar';
    avatar.src = sender === 'bot' ? '/static/ChatGPT%20Image%20Sep%2011,%202026,%2003_01_07%20AM.png' : '/static/user-avatar.svg'; avatar.alt = sender === 'bot' ? 'Noviq AI' : 'Your message';
    const content = document.createElement('div'); content.className = 'message-content';
    if (sender === 'bot') content.innerHTML = formatAssistantMessage(text); else content.textContent = text;
    messageDiv.append(avatar, content); chatMessages.appendChild(messageDiv);
    if (scroll) chatMessages.scrollTop = chatMessages.scrollHeight;
}

function showThinkingMessage() {
    if (!currentChat || pendingThinkingMessage) return;
    if (welcomeState.parentElement === chatMessages) welcomeState.remove();

    pendingThinkingMessage = document.createElement('div');
    pendingThinkingMessage.className = 'message bot thinking';

    const avatar = document.createElement('img');
    avatar.className = 'avatar';
    avatar.src = '/static/ChatGPT%20Image%20Sep%2011,%202026,%2003_01_07%20AM.png';
    avatar.alt = 'Noviq AI';

    const content = document.createElement('div');
    content.className = 'message-content';
    content.innerHTML = '<div class="thinking-label"><span class="thinking-dot"></span><span class="thinking-dot"></span><span class="thinking-dot"></span></div>';

    pendingThinkingMessage.append(avatar, content);
    chatMessages.appendChild(pendingThinkingMessage);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function hideThinkingMessage() {
    if (!pendingThinkingMessage) return;
    pendingThinkingMessage.remove();
    pendingThinkingMessage = null;
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function renderKaTeX(expression, displayMode) {
    if (!window.katex) return escapeHtml(expression);

    try {
        return window.katex.renderToString(expression, {
            displayMode,
            throwOnError: false,
            output: 'htmlAndMathml',
            strict: false,
            fleqn: false,
            trust: false
        });
    } catch {
        return escapeHtml(expression);
    }
}

function formatAssistantMessage(value) {
    let source = String(value ?? '').replace(/\r\n/g, '\n').trim();
    if (!source) return '';

    const codeBlocks = [];
    source = source.replace(/```([\s\S]*?)```/g, (_match, code) => {
        const token = `<span data-codeblock="${codeBlocks.length}"></span>`;
        codeBlocks.push(`<pre><code>${escapeHtml(code.trim())}</code></pre>`);
        return token;
    });

    const mathBlocks = [];
    source = source.replace(/\\\[([\s\S]*?)\\\]/g, (_match, expression) => {
        const token = `<span data-mathblock="${mathBlocks.length}"></span>`;
        mathBlocks.push(renderKaTeX(expression.trim(), true));
        return token;
    });

    const mathInlines = [];
    source = source.replace(/\\\(([^\n]*?)\\\)/g, (_match, expression) => {
        const token = `<span data-mathinline="${mathInlines.length}"></span>`;
        mathInlines.push(renderKaTeX(expression.trim(), false));
        return token;
    });

    source = source.replace(/(^|[^\\])\$([^$\n]+?)\$/g, (_match, prefix, expression) => {
        const token = `<span data-mathinline="${mathInlines.length}"></span>`;
        mathInlines.push(renderKaTeX(expression.trim(), false));
        return `${prefix}${token}`;
    });

    let html = '';
    if (window.marked) {
        html = window.marked.parse(source, {
            gfm: true,
            breaks: false,
            headerIds: false,
            mangle: false
        });
    } else {
        html = source
            .replace(/\n/g, '<br>')
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
    }

    html = html
        .replace(/<span data-codeblock="(\d+)"><\/span>/g, (_match, index) => codeBlocks[Number(index)] || '')
        .replace(/<span data-mathblock="(\d+)"><\/span>/g, (_match, index) => mathBlocks[Number(index)] || '')
        .replace(/<span data-mathinline="(\d+)"><\/span>/g, (_match, index) => mathInlines[Number(index)] || '');

    if (window.DOMPurify) {
        html = window.DOMPurify.sanitize(html, {
            USE_PROFILES: { html: true },
            ADD_ATTR: ['target', 'rel']
        });
    }

    return html;
}

async function checkConnection() {
    try {
        const response = await fetch('/models'); const data = await response.json();
        statusIndicator.className = 'status-dot ' + (data.error ? 'warning' : 'online');
        statusText.textContent = data.error ? 'Noviq limited' : 'Noviq connected';
    } catch {
        statusIndicator.className = 'status-dot offline';
        statusText.textContent = 'Server unavailable';
    }
}

async function sendMessage() {
    const message = userInput.value.trim();
    if (!message || sendBtn.disabled) return;

    if (!currentChat) currentChat = makeChat();
    if (!conversations.some(chat => chat.id === currentChat.id)) conversations.unshift(currentChat);
    if (currentChat.title === 'New conversation') currentChat.title = message.length > 38 ? message.slice(0, 38) + '…' : message;

    currentChat.messages.push({ text: message, sender: 'user' });
    saveChats();
    renderHistory();
    addMessage(message, 'user');

    userInput.value = '';
    userInput.style.height = 'auto';
    showThinkingMessage();
    typingIndicator.style.display = 'flex';
    sendBtn.disabled = true;
    thinkingText.textContent = effortSelect.value === 'max' ? 'Noviq is thinking deeply...' : 'Noviq is thinking...';

    try {
        const response = await fetch('/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Device-ID': deviceId },
            body: JSON.stringify({
                message,
                session_id: currentSession(),
                model: composerModelSelect.value,
                effort: effortSelect.value,
                prompt_count: promptsUsed,
                history: requestHistory().slice(0, -1)
            })
        });

        const data = await response.json();
        updateQuota(data.quota);
        const reply = data.error ? '⚠️ ' + data.error : data.response;

        currentChat.messages.push({ text: reply, sender: 'bot' });
        saveChats();
        hideThinkingMessage();
        addMessage(reply, 'bot');
    } catch {
        const reply = '⚠️ Network error. Please try again.';
        currentChat.messages.push({ text: reply, sender: 'bot' });
        saveChats();
        hideThinkingMessage();
        addMessage(reply, 'bot');
    } finally {
        typingIndicator.style.display = 'none';
        thinkingText.textContent = 'Enter to send · Shift + Enter for a new line';
        if (promptsUsed < 5) sendBtn.disabled = false;
        userInput.focus();
    }
}

async function resetChat() {
    if (currentChat?.messages.length) {
        try {
            await fetch('/reset', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-ID': deviceId }, body: JSON.stringify({ session_id: currentSession() }) });
        } catch { /* local reset still works */ }
    }
    startNewChat();
}

function closeSidebar() { sidebar.classList.remove('open'); mobileBackdrop.classList.remove('visible'); }
function toggleSidebar() { sidebar.classList.toggle('open'); mobileBackdrop.classList.toggle('visible'); }
function setSidebarVisibility(hidden) { appShell.classList.toggle('sidebar-hidden', hidden); localStorage.setItem('noviq-sidebar-hidden', hidden ? '1' : '0'); }

function showShareToast() {
    if (!shareToast) return;

    shareToast.classList.add('show');
    clearTimeout(shareToastTimer);
    shareToastTimer = setTimeout(() => {
        shareToast.classList.remove('show');
    }, 1800);
}

async function shareChat() {
    if (!currentChat || !currentChat.messages.length) {
        alert('Start a chat first, then share it with a link.');
        return;
    }

    const shareLink = buildShareUrl();
    if (!shareLink) {
        alert('Unable to create a share link for this chat.');
        return;
    }

    try {
        await navigator.clipboard.writeText(shareLink);
        shareButton.setAttribute('aria-label', 'Link copied');
        shareButton.title = 'Link copied';
        showShareToast();
        setTimeout(() => {
            shareButton.setAttribute('aria-label', 'Share chat');
            shareButton.title = 'Share chat';
        }, 1500);
    } catch {
        window.prompt('Copy this chat link:', shareLink);
    }
}

sendBtn.addEventListener('click', sendMessage);
resetBtn.addEventListener('click', resetChat);
document.getElementById('menuButton').addEventListener('click', toggleSidebar);
document.getElementById('sidebarClose').addEventListener('click', closeSidebar);
mobileBackdrop.addEventListener('click', closeSidebar);
document.getElementById('sidebarToggle').addEventListener('click', () => setSidebarVisibility(true));
document.getElementById('desktopSidebarToggle').addEventListener('click', () => setSidebarVisibility(false));
historySearch.addEventListener('input', () => renderHistory(historySearch.value));
document.getElementById('clearHistoryBtn').addEventListener('click', async () => { if (!conversations.length || !confirm('Delete all saved conversations on this device?')) return; await Promise.all(conversations.map(chat => fetch('/reset', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-ID': deviceId }, body: JSON.stringify({ session_id: chat.id }) }).catch(() => null))); conversations = []; saveChats(); startNewChat(); });
document.getElementById('aboutButton').addEventListener('click', () => aboutDialog.showModal());
document.getElementById('aboutClose').addEventListener('click', () => aboutDialog.close());
aboutDialog.addEventListener('click', event => { if (event.target === aboutDialog) aboutDialog.close(); });
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferredInstallPrompt = event; installButton.hidden = false; });
installButton.addEventListener('click', async () => {
    if (deferredInstallPrompt) { deferredInstallPrompt.prompt(); await deferredInstallPrompt.userChoice; deferredInstallPrompt = null; installButton.hidden = true; return; }
    alert('To install Noviq AI: use your browser menu and choose "Install app" or "Add to Home Screen".');
});
if (themeToggle) themeToggle.addEventListener('click', () => setTheme(document.body.classList.contains('dark-mode') ? 'light' : 'dark'));
if (shareButton) shareButton.addEventListener('click', shareChat);
document.querySelectorAll('.prompt-card').forEach(card => card.addEventListener('click', () => { userInput.value = card.dataset.prompt; userInput.dispatchEvent(new Event('input')); userInput.focus(); }));
userInput.addEventListener('input', function () { this.style.height = 'auto'; this.style.height = Math.min(this.scrollHeight, 145) + 'px'; });
userInput.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(); } });
document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); startNewChat(); } });

const sharedChat = readSharedChatFromUrl();
if (sharedChat) {
    conversations = [sharedChat, ...conversations.filter(chat => chat.id !== sharedChat.id)];
    currentChat = sharedChat;
    saveChats();
}

if (currentChat) {
    renderMessages();
    renderHistory(historySearch.value);
} else if (conversations.length) {
    openChat(conversations[0].id);
} else {
    startNewChat();
}

setSidebarVisibility(localStorage.getItem('noviq-sidebar-hidden') === '1');
restoreQuota();
checkConnection();
setTheme(localStorage.getItem(THEME_KEY) || 'light');
