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
const STORAGE_KEY = 'noviq-ai-chats';
const DEVICE_KEY = 'noviq-ai-device-id';
let conversations = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
let deviceId = localStorage.getItem(DEVICE_KEY);
let currentChat = null;
let deferredInstallPrompt = null;
let promptsUsed = Number(localStorage.getItem('noviq-prompts-used') || 0);
let quotaResetAt = localStorage.getItem('noviq-quota-reset-at') || '';
if (quotaResetAt && Date.now() >= Date.parse(quotaResetAt)) { promptsUsed = 0; localStorage.removeItem('noviq-prompts-used'); localStorage.removeItem('noviq-quota-reset-at'); }
if (!deviceId) { deviceId = crypto.randomUUID ? crypto.randomUUID() : 'device_' + Date.now() + '_' + Math.random().toString(36).slice(2); localStorage.setItem(DEVICE_KEY, deviceId); }

function makeChat() { return { id: 'chat_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8), title: 'New conversation', messages: [] }; }
function saveChats() { localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations)); }
function currentSession() { return currentChat ? currentChat.id : ''; }
function updateQuota(quota) {
    if (!quota) return;
    promptsUsed = quota.used;
    quotaResetAt = quota.reset_at || '';
    localStorage.setItem('noviq-prompts-used', String(promptsUsed));
    localStorage.setItem('noviq-quota-reset-at', quotaResetAt);
    [...quotaMeter.children].forEach((circle, index) => circle.classList.toggle('used', index < promptsUsed));
    quotaLabel.textContent = quota.remaining ? `${quota.remaining} left today` : 'Available tomorrow';
}

function restoreQuota() {
    [...quotaMeter.children].forEach((circle, index) => circle.classList.toggle('used', index < promptsUsed));
    quotaLabel.textContent = promptsUsed >= 5 ? 'Available tomorrow' : `${5 - promptsUsed} left today`;
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
        avatar.src = sender === 'bot' ? '/static/Noviq%20AI%20Glossy%20Ribbon%20Logo.png' : '/static/user-avatar.svg'; avatar.alt = sender === 'bot' ? 'Noviq AI' : 'Your message';
    const content = document.createElement('div'); content.className = 'message-content';
    if (sender === 'bot') content.innerHTML = formatAssistantMessage(text); else content.textContent = text;
    messageDiv.append(avatar, content); chatMessages.appendChild(messageDiv);
    if (scroll) chatMessages.scrollTop = chatMessages.scrollHeight;
}

function escapeHtml(value) {
    return value.replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function formatAssistantMessage(value) {
    let html = escapeHtml(String(value).replace(/\r\n/g, '\n')).trim();
    html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
    html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>').replace(/^## (.+)$/gm, '<h3>$1</h3>').replace(/^# (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^\|(.+)\|$/gm, line => '<div class="table-line">' + line.split('|').slice(1, -1).map(cell => `<span>${cell.trim()}</span>`).join('') + '</div>');
    html = html.replace(/^(?:[-*])\s+(.+)$/gm, '<li>$1</li>').replace(/^(\d+)\.\s+(.+)$/gm, '<li>$2</li>');
    html = html.replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*([^*\n]+)\*/g, '<em>$1</em>').replace(/`([^`]+)`/g, '<code>$1</code>');
    return html.split(/\n{2,}/).map(block => block.trim().startsWith('<') ? block.trim() : `<p>${block.trim().replace(/\n/g, '<br>')}</p>`).join('');
}

async function checkConnection() {
    try {
        const response = await fetch('/models'); const data = await response.json();
        statusIndicator.className = 'status-dot ' + (data.error ? 'warning' : 'online'); statusText.textContent = data.error ? 'Noviq limited' : 'Noviq connected';
    } catch { statusIndicator.className = 'status-dot offline'; statusText.textContent = 'Server unavailable'; }
}

async function sendMessage() {
    const message = userInput.value.trim(); if (!message || sendBtn.disabled) return;
    if (!currentChat) currentChat = makeChat();
    if (!conversations.some(chat => chat.id === currentChat.id)) conversations.unshift(currentChat);
    if (currentChat.title === 'New conversation') currentChat.title = message.length > 38 ? message.slice(0, 38) + '…' : message;
    currentChat.messages.push({ text: message, sender: 'user' }); saveChats(); renderHistory(); addMessage(message, 'user');
    userInput.value = ''; userInput.style.height = 'auto'; typingIndicator.style.display = 'flex'; sendBtn.disabled = true;
    thinkingText.textContent = effortSelect.value === 'max' ? 'Noviq is thinking deeply...' : 'Noviq is thinking...';
    try {
        const response = await fetch('/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-ID': deviceId }, body: JSON.stringify({ message, session_id: currentSession(), model: composerModelSelect.value, effort: effortSelect.value }) });
        const data = await response.json();
        updateQuota(data.quota);
        const reply = data.error ? '⚠️ ' + data.error : data.response;
        currentChat.messages.push({ text: reply, sender: 'bot' }); saveChats(); addMessage(reply, 'bot');
    } catch { const reply = '⚠️ Network error. Please try again.'; currentChat.messages.push({ text: reply, sender: 'bot' }); saveChats(); addMessage(reply, 'bot'); }
    finally { typingIndicator.style.display = 'none'; thinkingText.textContent = 'Enter to send · Shift + Enter for a new line'; if (promptsUsed < 5) sendBtn.disabled = false; userInput.focus(); }
}

async function resetChat() { if (currentChat?.messages.length) { try { await fetch('/reset', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-ID': deviceId }, body: JSON.stringify({ session_id: currentSession() }) }); } catch { /* local reset still works */ } } startNewChat(); }
function closeSidebar() { sidebar.classList.remove('open'); mobileBackdrop.classList.remove('visible'); }
function toggleSidebar() { sidebar.classList.toggle('open'); mobileBackdrop.classList.toggle('visible'); }
function setSidebarVisibility(hidden) { appShell.classList.toggle('sidebar-hidden', hidden); localStorage.setItem('noviq-sidebar-hidden', hidden ? '1' : '0'); }

sendBtn.addEventListener('click', sendMessage); resetBtn.addEventListener('click', resetChat); document.getElementById('menuButton').addEventListener('click', toggleSidebar); document.getElementById('sidebarClose').addEventListener('click', closeSidebar); mobileBackdrop.addEventListener('click', closeSidebar);
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
document.querySelectorAll('.prompt-card').forEach(card => card.addEventListener('click', () => { userInput.value = card.dataset.prompt; userInput.dispatchEvent(new Event('input')); userInput.focus(); }));
userInput.addEventListener('input', function () { this.style.height = 'auto'; this.style.height = Math.min(this.scrollHeight, 145) + 'px'; });
userInput.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(); } });
document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); startNewChat(); } });

if (conversations.length) openChat(conversations[0].id); else startNewChat();
setSidebarVisibility(localStorage.getItem('noviq-sidebar-hidden') === '1');
restoreQuota();
checkConnection();
