// --- SCRIPT.JS V14 (Final Fixes) ---
console.log("--- SCRIPT.JS V14 LOADED ---");

document.addEventListener('DOMContentLoaded', () => {
    console.log("--- DOMCONTENTLOADED FIRED ---");

    // --- 1. GLOBAL STATE ---
    const API_URL = 'https://accessible-library-api.onrender.com';
    let currentLang = 'en-US';
    let currentBook = null;
    let currentView = 'selection';
    let currentTab = 'ask';
    
    let globalLibraryData = { categories: {}, books: {} };
    let globalQuestionBank = [];
    let currentFlashcardDeck = [];
    let currentBookSummary = null;
    let currentPlaybackRate = 1.0;
    
    let isChatBotListening = false;
    let currentAudio = null;
    let currentPage = 1;
    let totalPages = 0;

    // --- TRANSLATIONS ---
    const translations = {
        'en-US': {
            'lang_switcher': 'TH', 'all_books_filter': 'All Books', 'my_library': 'My Library', 'back_to_selection': 'Back to Selection', 'select_category': 'Filter by Category', 'books_in_category': 'All Books', 'tab_ask': 'Ask (Q&A)', 'tab_summary': 'Summary', 'tab_read': 'Read Book', 'tab_test': 'Mock Exam', 'placeholder_ask': 'Type your question...', 'btn_send': 'Send', 'btn_start_voice': 'Start Voice', 'label_speech_speed': 'Speech Speed:', 'summary_title': 'Book Summary', 'btn_prev_page': 'Previous Page', 'btn_next_page': 'Next Page', 'scan_title': 'Book Not Optimized', 'scan_desc_1': "This book's text has not been scanned and optimized for reading. You can read the raw text, but it may be jumbled.", 'scan_desc_2': 'For the best experience, an admin can run the "Scan & Optimize" process from the Admin Panel.', 'btn_scan_book': 'Scan & Optimize Book (Slow)', 'q_bank_not_found': 'Question Bank Not Found', 'q_bank_desc': "This book doesn't have a question bank for this language yet.", 'btn_generate_q_bank': 'Generate Question Bank (5-10 Mins)', 'portal_title': 'Mock Exam Portal', 'btn_start_session': 'Start Flashcard Session', 'btn_reset_progress': 'Reset All Progress', 'btn_next_card': 'Next Card', 'btn_quit_session': 'Quit Session', 'welcome_message': 'Loaded "{bookName}". You can ask me questions or click the other tabs for more info.'
        },
        'th-TH': {
            'lang_switcher': 'EN', 'all_books_filter': 'หนังสือทั้งหมด', 'my_library': 'คลังหนังสือของฉัน', 'back_to_selection': 'กลับไปหน้าเลือก', 'select_category': 'กรองตามหมวดหมู่', 'books_in_category': 'หนังสือทั้งหมด', 'tab_ask': 'ถาม-ตอบ', 'tab_summary': 'บทสรุป', 'tab_read': 'อ่านหนังสือ', 'tab_test': 'ทำข้อสอบ', 'placeholder_ask': 'พิมพ์คำถามของคุณ...', 'btn_send': 'ส่ง', 'btn_start_voice': 'เริ่มพูด', 'label_speech_speed': 'ความเร็วเสียง:', 'summary_title': 'บทสรุปหนังสือ', 'btn_prev_page': 'หน้าก่อนหน้า', 'btn_next_page': 'หน้าถัดไป', 'scan_title': 'หนังสือยังไม่ได้เพิ่มประสิทธิภาพ', 'scan_desc_1': 'ข้อความในหนังสือเล่มนี้ยังไม่ได้ถูกสแกนและเพิ่มประสิทธิภาพในการอ่าน คุณสามารถอ่านข้อความดิบได้ แต่อาจมีโครงสร้างไม่ถูกต้อง', 'scan_desc_2': 'เพื่อประสบการณ์ที่ดีที่สุด ผู้ดูแลระบบสามารถกด "สแกนและเพิ่มประสิทธิภาพ" ได้ที่หน้า Admin', 'btn_scan_book': 'สแกนและเพิ่มประสิทธิภาพ (ช้า)', 'q_bank_not_found': 'ไม่พบชุดคำถาม', 'q_bank_desc': 'ยังไม่มีชุดคำถามสำหรับหนังสือเล่มนี้ในภาษานี้', 'btn_generate_q_bank': 'สร้างชุดคำถาม (5-10 นาที)', 'portal_title': 'ศูนย์แบบทดสอบ', 'btn_start_session': 'เริ่มทำแบบทดสอบ', 'btn_reset_progress': 'รีเซ็ตความคืบหน้าทั้งหมด', 'btn_next_card': 'การ์ดถัดไป', 'btn_quit_session': 'จบการทดสอบ', 'welcome_message': 'โหลดหนังสือ "{bookName}" เรียบร้อยแล้ว คุณสามารถถามคำถาม หรือกดแท็บอื่นๆ เพื่อดูข้อมูลเพิ่มเติม'
        }
    };

    // --- HELPER FUNCTIONS ---
    function renderContent(element, text) {
        if (!text) { element.innerHTML = ""; return; }
        let htmlContent = text;
        try {
            if (window.marked) {
                marked.use({ breaks: true, gfm: true });
                htmlContent = marked.parse(text);
            } else { htmlContent = text.replace(/\n/g, '<br>'); }
        } catch (e) { console.error("Markdown error:", e); htmlContent = text; }
        element.innerHTML = htmlContent;
        if (window.renderMathInElement) {
            renderMathInElement(element, {
                delimiters: [{left: '$$', right: '$$', display: true}, {left: '$', right: '$', display: false}, {left: '\\(', right: '\\)', display: false}, {left: '\\[', right: '\\]', display: true}],
                throwOnError: false
            });
        }
    }

    function scrollToBottom() {
        if (chatLog) {
            chatLog.scrollTop = chatLog.scrollHeight;
            requestAnimationFrame(() => { chatLog.scrollTop = chatLog.scrollHeight; });
        }
    }
    
    // --- 2. DOM ELEMENTS ---
    const globalLoader = document.getElementById('global-loader');
    const loaderText = document.getElementById('loader-text');
    const chatLog = document.getElementById('chat-log');
    const chatTextInput = document.getElementById('chat-text-input');
    const chatSendBtn = document.getElementById('chat-send-btn');
    const chatVoiceBtn = document.getElementById('chat-voice-btn');
    const chatStatus = document.getElementById('chat-status');
    const mobileSidebarToggle = document.getElementById('mobile-sidebar-toggle');
    const sidebarContainer = document.getElementById('sidebar-container');
    const sidebarOverlay = document.getElementById('sidebar-overlay');
    const selectionPage = document.getElementById('selection-page');
    const learningPage = document.getElementById('learning-page');
    const adminPage = document.getElementById('admin-page');
    const bookListSidebar = document.getElementById('book-list-sidebar');
    const bookFolderTree = document.getElementById('book-folder-tree');
    const backToSelectionBtn = document.getElementById('back-to-selection-btn');
    const langSwitcherBtn = document.getElementById('lang-switcher-btn');
    const adminPageBtn = document.getElementById('admin-page-btn');
    const backToLibraryBtn = document.getElementById('back-to-library-btn');
    const categorySelectionGroup = document.getElementById('category-selection-group');
    const bookListArea = document.getElementById('book-list-area');
    const tabButtons = { ask: document.getElementById('tab-btn-ask'), summary: document.getElementById('tab-btn-summary'), read: document.getElementById('tab-btn-read'), test: document.getElementById('tab-btn-test') };
    const tabViews = { ask: document.getElementById('ask-view'), summary: document.getElementById('summary-view'), read: document.getElementById('read-view'), test: document.getElementById('test-view') };
    const readViewReaderPanel = document.getElementById('read-view-reader');
    const readViewScanPanel = document.getElementById('read-view-scan');
    const startScanBtn = document.getElementById('start-scan-btn');
    const scanStatus = document.getElementById('scan-status');
    const readContent = document.getElementById('read-view-content');
    const pageIndicator = document.getElementById('page-indicator');
    const pagePrevBtn = document.getElementById('page-prev-btn');
    const pageNextBtn = document.getElementById('page-next-btn');
    const summaryContentArea = document.getElementById('summary-content-area');
    const qBankGeneratePanel = document.getElementById('q-bank-generate');
    const generateQBankBtn = document.getElementById('generate-q-bank-btn');
    const qBankGenerateStatus = document.getElementById('q-bank-generate-status');
    const qBankPortalPanel = document.getElementById('q-bank-portal');
    const qBankStats = document.getElementById('q-bank-stats');
    const startFlashcardBtn = document.getElementById('start-flashcard-btn');
    const qBankAnsweredList = document.getElementById('q-bank-answered-list');
    const resetQuizProgressBtn = document.getElementById('reset-quiz-progress-btn');
    const qBankFlashcardPanel = document.getElementById('q-bank-flashcard');
    const flashcardQuestionArea = document.getElementById('flashcard-question-area');
    const flashcardOptionsArea = document.getElementById('flashcard-options-area');
    const flashcardFeedbackArea = document.getElementById('flashcard-feedback-area');
    const flashcardNextBtn = document.getElementById('flashcard-next-btn');
    const flashcardQuitBtn = document.getElementById('flashcard-quit-btn');
    const adminCategoryList = document.getElementById('admin-category-list');
    const addCategoryForm = document.getElementById('admin-add-category-form');
    const newCatNameInput = document.getElementById('new-cat-name');
    const newCatIdInput = document.getElementById('new-cat-id');
    const adminUploadForm = document.getElementById('admin-upload-form');
    const uploadDisplayName = document.getElementById('upload-display-name');
    const uploadCategorySelect = document.getElementById('upload-category');
    const uploadFileInput = document.getElementById('upload-file');
    const uploadStatus = document.getElementById('upload-status');
    const adminBookList = document.getElementById('admin-book-list');

    // --- 3. ASR SETUP ---
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    let webRecognition;
    if (SpeechRecognition) {
        webRecognition = new SpeechRecognition();
        webRecognition.continuous = false; webRecognition.interimResults = false;
        webRecognition.onresult = (event) => {
            if (currentView === 'learning' && currentTab === 'ask') handleRAGCommand(event.results[0][0].transcript.trim());
        };
        webRecognition.onend = () => { if (currentLang === 'en-US') stopChatListening(); };
    }
    let mediaRecorder = null, audioChunks = [];

    // --- 4. TTS ---
    function speak(text, onEndCallback = null) {
        if (!text || typeof text !== 'string' || text.trim() === "") { if (onEndCallback) onEndCallback(); return; }
        if (currentAudio) { currentAudio.pause(); currentAudio = null; }
        if(chatStatus) chatStatus.textContent = "Speaking...";
        fetch(`${API_URL}/synthesize-speech`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: text, lang: currentLang }) })
        .then(res => res.ok ? res.blob() : Promise.reject("TTS API failed"))
        .then(blob => {
            currentAudio = new Audio(URL.createObjectURL(blob));
            currentAudio.playbackRate = currentPlaybackRate;
            currentAudio.play();
            currentAudio.onended = () => { if(chatStatus) chatStatus.textContent = "Ready."; currentAudio = null; if (onEndCallback) onEndCallback(); };
        })
        .catch(err => { console.error("TTS Error:", err); if(chatStatus) chatStatus.textContent = "TTS Error."; if (onEndCallback) onEndCallback(); });
    }

    // --- 5. LOADER ---
    function showLoader(text = "Loading...") { loaderText.textContent = text; globalLoader.classList.remove('hidden'); }
    function hideLoader() { globalLoader.classList.add('hidden'); }

    // --- 6. LOGIC ---
    function setLanguage(lang) {
        currentLang = lang; localStorage.setItem('lastLang', lang);
        document.querySelectorAll('[data-lang-key]').forEach(el => {
            const key = el.dataset.langKey;
            if (translations[lang] && translations[lang][key]) {
                if (el.tagName === 'INPUT' && el.type === 'text') el.placeholder = translations[lang][key];
                else el.textContent = translations[lang][key];
            }
        });
        langSwitcherBtn.textContent = translations[lang]['lang_switcher'];
    }
    function toggleLanguage() {
        setLanguage((currentLang === 'en-US') ? 'th-TH' : 'en-US');
        if (currentBook) {
            currentBookSummary = null;
            if (currentTab === 'summary') loadBookSummary();
            if (currentTab === 'test') loadQuestionBank();
            chatLog.innerHTML = '';
            const historyLoaded = loadChatHistory(currentBook);
            if (!historyLoaded) addAiBubble(translations[currentLang]['welcome_message'].replace('{bookName}', globalLibraryData.books[currentBook].display_name), false);
        }
    }
    function showMainView(viewName) {
        currentView = viewName;
        selectionPage.classList.toggle('hidden', viewName !== 'selection');
        learningPage.classList.toggle('hidden', viewName !== 'learning');
        adminPage.classList.toggle('hidden', viewName !== 'admin');
        if(sidebarContainer) sidebarContainer.classList.remove('active');
        if(sidebarOverlay) sidebarOverlay.classList.remove('active');
        
        if (viewName === 'admin') {
            adminPageBtn.classList.add('hidden');
            populateAdminPage(); // IMPORTANT: Refresh the admin list when opening
        } else {
            adminPageBtn.classList.remove('hidden');
        }
    }
    function showLearningTab(tabName) {
        currentTab = tabName;
        for (const [key, btn] of Object.entries(tabButtons)) btn.classList.toggle('active', key === tabName);
        for (const [key, view] of Object.entries(tabViews)) view.classList.toggle('hidden', key !== tabName);
        if (currentAudio) { currentAudio.pause(); currentAudio = null; }
        if (currentBook) localStorage.setItem('lastTab', tabName);
        if (tabName === 'test') loadQuestionBank();
        else if (tabName === 'summary') loadBookSummary(); 
        else if (tabName === 'read') loadReadBookTab();
        if (tabName === 'ask') scrollToBottom();
    }
    function populateSelectionPage() {
        categorySelectionGroup.innerHTML = ''; bookFolderTree.innerHTML = '';
        const categories = globalLibraryData.categories; const books = globalLibraryData.books;
        const allBtn = document.createElement('button');
        allBtn.className = 'nav-button active'; allBtn.textContent = translations[currentLang]['all_books_filter'] || 'All Books';
        allBtn.dataset.category = 'all'; allBtn.addEventListener('click', () => filterBooksByCategory('all'));
        categorySelectionGroup.appendChild(allBtn);
        for (const [catId, catName] of Object.entries(categories)) {
            const btn = document.createElement('button');
            btn.className = 'nav-button'; btn.textContent = catName; btn.dataset.category = catId;
            btn.addEventListener('click', () => filterBooksByCategory(catId));
            categorySelectionGroup.appendChild(btn);
            const folderDiv = document.createElement('div');
            folderDiv.className = 'folder';
            const title = document.createElement('h4'); title.textContent = catName; folderDiv.appendChild(title);
            for (const [bookId, bookMeta] of Object.entries(books)) {
                if (bookMeta.category === catId) {
                    const link = document.createElement('a');
                    link.href = '#'; link.className = 'book-link'; link.textContent = bookMeta.display_name;
                    link.dataset.bookid = bookId; link.addEventListener('click', (e) => { e.preventDefault(); selectBook(bookId); });
                    folderDiv.appendChild(link);
                }
            }
            bookFolderTree.appendChild(folderDiv);
        }
        filterBooksByCategory('all');
    }
    function filterBooksByCategory(cat) {
        document.querySelectorAll('#category-selection-group .nav-button').forEach(btn => btn.classList.toggle('active', btn.dataset.category === cat));
        bookListArea.innerHTML = '';
        let found = false;
        for (const [bid, meta] of Object.entries(globalLibraryData.books)) {
            if (cat === 'all' || meta.category === cat) {
                found = true;
                const btn = document.createElement('button');
                btn.className = 'nav-button book-button'; btn.textContent = meta.display_name;
                btn.dataset.bookid = bid; btn.addEventListener('click', () => selectBook(bid));
                bookListArea.appendChild(btn);
            }
        }
        if (!found) bookListArea.innerHTML = '<p>No books found in this category.</p>';
    }
    async function selectBook(bookId) {
        if (currentBook === bookId && currentView === 'learning') return;
        currentBook = bookId; localStorage.setItem('lastBookId', bookId);
        chatLog.innerHTML = ''; currentBookSummary = null; globalQuestionBank = [];
        document.querySelectorAll('.book-link').forEach(link => link.classList.toggle('active', link.dataset.bookid === bookId));
        showMainView('learning'); showLearningTab('ask');
        const historyLoaded = loadChatHistory(bookId);
        if (!historyLoaded) addAiBubble(translations[currentLang]['welcome_message'].replace('{bookName}', globalLibraryData.books[currentBook].display_name), false);
    }
    
    // --- History ---
    function loadChatHistory(bookId) {
        const history = JSON.parse(localStorage.getItem(`chat_history_${bookId}`) || '[]');
        if (history.length === 0) return false;
        history.forEach(msg => {
            const bubble = document.createElement('div');
            bubble.className = `chat-bubble ${msg.role === 'user' ? 'user' : 'ai'}`;
            if (msg.role === 'user') bubble.innerText = msg.content;
            else renderContent(bubble, msg.content);
            chatLog.appendChild(bubble);
        });
        scrollToBottom(); return true;
    }
    function saveChatEntry(role, content) {
        if (!currentBook) return;
        const k = `chat_history_${currentBook}`;
        const h = JSON.parse(localStorage.getItem(k) || '[]');
        h.push({ role: role, content: content });
        localStorage.setItem(k, JSON.stringify(h));
    }

    // --- Chat ---
    const addUserBubble = (text) => {
        if (!text) return;
        const b = document.createElement('div'); b.className = 'chat-bubble user'; b.innerText = text;
        chatLog.appendChild(b); scrollToBottom(); saveChatEntry('user', text);
    };
    function addAiBubble(text, save = true) {
        if (!text) return;
        const b = document.createElement('div'); b.className = 'chat-bubble ai';
        renderContent(b, text); chatLog.appendChild(b); scrollToBottom();
        if (save) saveChatEntry('ai', text);
    }

    // --- ASR/TTS Functions ---
    function startChatListening() {
        if (isChatBotListening) return; isChatBotListening = true;
        chatStatus.textContent = "Listening..."; chatVoiceBtn.textContent = "Listening..."; chatVoiceBtn.classList.add('glowing');
        if (currentLang === 'en-US') { if(webRecognition) { webRecognition.lang = 'en-US'; webRecognition.start(); } else { alert("No Web Speech"); stopChatListening(); } }
        else { startTyphoonListening(); }
    }
    async function startTyphoonListening() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream); audioChunks = [];
            mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
            mediaRecorder.onstop = async () => {
                const blob = new Blob(audioChunks, { type: 'audio/webm' });
                chatStatus.textContent = "Transcribing...";
                const fd = new FormData(); fd.append("file", blob, "recording.webm");
                try {
                    const res = await fetch(`${API_URL}/transcribe-audio`, { method: 'POST', body: fd });
                    if(!res.ok) throw new Error("Failed");
                    const data = await res.json();
                    if(data.text) handleRAGCommand(data.text);
                } catch(e) { console.error(e); alert("ASR Failed"); }
            };
            mediaRecorder.start();
        } catch(e) { console.error(e); alert("Mic Error"); stopChatListening(); }
    }
    function stopChatListening() {
        if (!isChatBotListening) return; isChatBotListening = false;
        chatStatus.textContent = "Ready."; chatVoiceBtn.textContent = translations[currentLang]['btn_start_voice']; chatVoiceBtn.classList.remove('glowing');
        if (currentLang === 'en-US' && webRecognition) webRecognition.stop();
        else if (mediaRecorder && mediaRecorder.state !== "inactive") { mediaRecorder.stop(); mediaRecorder.stream.getTracks().forEach(t => t.stop()); }
    }
    async function handleRAGCommand(transcript) {
        if (!currentBook) return;
        addUserBubble(transcript); showLoader("Thinking...");
        try {
            const res = await fetch(`${API_URL}/chat`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ query: transcript, book_id: currentBook, lang: currentLang }) });
            if (!res.ok) throw new Error((await res.json()).detail);
            const data = await res.json();
            const txt = data.structured || data.answer || "Sorry, error.";
            addAiBubble(txt, true); if (data.speech) speak(data.speech);
        } catch(e) { addAiBubble(`Error: ${e.message}`, false); } finally { hideLoader(); }
    }

    // --- Content Tabs ---
    function loadReadBookTab() {
        if (!currentBook) return;
        if (globalLibraryData.books[currentBook].is_scanned) {
            readViewReaderPanel.classList.remove('hidden'); readViewScanPanel.classList.add('hidden'); fetchPage(1);
        } else {
            readViewReaderPanel.classList.add('hidden'); readViewScanPanel.classList.remove('hidden'); scanStatus.textContent = "";
        }
    }
    async function fetchPage(n) {
        showLoader("Loading page...");
        try {
            const res = await fetch(`${API_URL}/book-page/${currentBook}/${n}`);
            if (!res.ok) throw new Error();
            const data = await res.json();
            renderContent(readContent, data.text);
            currentPage = data.page_num; totalPages = data.total_pages;
            pageIndicator.textContent = `Page ${currentPage} / ${totalPages}`;
            pagePrevBtn.disabled = (currentPage===1); pageNextBtn.disabled = (currentPage===totalPages);
        } catch(e) { readContent.textContent = "Error loading page."; } finally { hideLoader(); }
    }
    async function loadBookSummary() {
        if (currentBookSummary) { renderContent(summaryContentArea, currentBookSummary); return; }
        showLoader("Loading Summary...");
        try {
            const res = await fetch(`${API_URL}/get-book-summary`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ query: "", book_id: currentBook, lang: currentLang }) });
            if (!res.ok) throw new Error((await res.json()).detail);
            const data = await res.json();
            currentBookSummary = data.answer; renderContent(summaryContentArea, currentBookSummary);
        } catch(e) { summaryContentArea.textContent = "Summary failed."; } finally { hideLoader(); }
    }

    // --- Quiz ---
    function getQuizProgress() { return JSON.parse(localStorage.getItem(`quiz_progress_${currentBook}_${currentLang}`) || '{}'); }
    function saveQuizProgress(p) { localStorage.setItem(`quiz_progress_${currentBook}_${currentLang}`, JSON.stringify(p)); }
    async function loadQuestionBank() {
        showLoader("Loading Quiz...");
        try {
            const res = await fetch(`${API_URL}/get-question-bank/${currentBook}/${currentLang}`);
            if(res.status===404) { globalQuestionBank=[]; showTestPanel('q-bank-generate'); return; }
            if(!res.ok) throw new Error();
            globalQuestionBank = await res.json(); showTestPanel('q-bank-portal'); updateQuizStats();
        } catch(e) { showTestPanel('q-bank-generate'); qBankGenerateStatus.textContent = e.message; } finally { hideLoader(); }
    }
    async function handleGenerateQuestionBank() {
        qBankGenerateStatus.textContent = "Generating..."; generateQBankBtn.disabled=true; showLoader("Generating...");
        try {
            const res = await fetch(`${API_URL}/generate-question-bank/${currentBook}/${currentLang}`, { method: 'POST' });
            qBankGenerateStatus.textContent = (await res.json()).message;
        } catch(e) { qBankGenerateStatus.textContent = "Error"; generateQBankBtn.disabled=false; } finally { hideLoader(); }
    }
    function updateQuizStats() {
        const p = getQuizProgress(); const total = Object.keys(p).length;
        qBankStats.innerHTML = `Answered: ${total}/${globalQuestionBank.length}`;
        qBankAnsweredList.innerHTML = `<h4>Answered</h4>`;
        for(const [i, d] of Object.entries(p)) {
            const q = globalQuestionBank[i]; if(!q) continue;
            const dDiv = document.createElement('div'); dDiv.className = d.isCorrect?'answered-q-item correct':'answered-q-item wrong';
            dDiv.innerHTML=`<p>${q.question}</p><small>${d.isCorrect?'Correct':'Wrong'}</small>`;
            qBankAnsweredList.appendChild(dDiv);
        }
    }
    function showTestPanel(id) {
        ['q-bank-generate', 'q-bank-portal', 'q-bank-flashcard'].forEach(pid => document.getElementById(pid).classList.add('hidden'));
        document.getElementById(id).classList.remove('hidden');
    }
    function startFlashcardSession() {
        const p = getQuizProgress(); const answered = Object.keys(p).map(Number);
        const avail = globalQuestionBank.map((q, i) => ({...q, idx: i})).filter((q, i) => !answered.includes(i));
        if(avail.length===0) { alert("Done!"); return; }
        currentFlashcardDeck = avail.sort(() => 0.5 - Math.random());
        showTestPanel('q-bank-flashcard'); showNextFlashcard();
    }
    function showNextFlashcard() {
        flashcardFeedbackArea.classList.add('hidden');
        const card = currentFlashcardDeck.pop();
        if(!card) { alert("Session done!"); loadQuestionBank(); return; }
        flashcardQuestionArea.textContent = card.question; flashcardOptionsArea.innerHTML='';
        card.options.forEach((opt, i) => {
            const btn = document.createElement('button'); btn.className='flashcard-option-btn'; btn.textContent=opt;
            btn.onclick = () => {
                const isCor = (i === card.correctAnswerIndex);
                const p = getQuizProgress(); p[card.idx] = { userAnswerIndex: i, isCorrect: isCor }; saveQuizProgress(p);
                flashcardOptionsArea.querySelectorAll('button').forEach(b => b.disabled=true);
                btn.classList.add(isCor?'correct':'wrong');
                flashcardFeedbackArea.querySelector('span').textContent = isCor?"Correct!":"Wrong!";
                flashcardFeedbackArea.classList.remove('hidden');
            };
            flashcardOptionsArea.appendChild(btn);
        });
    }
    function handleResetProgress() { if(confirm("Reset?")) { localStorage.removeItem(`quiz_progress_${currentBook}_${currentLang}`); updateQuizStats(); } }

    // --- ADMIN (FIXED) ---
    function populateAdminPage() {
        adminCategoryList.innerHTML = '';
        adminBookList.innerHTML = '';
        uploadCategorySelect.innerHTML = '';
        
        const categories = globalLibraryData.categories || {};
        const books = globalLibraryData.books || {};

        for (const [catId, catName] of Object.entries(categories)) {
            const opt = document.createElement('option');
            opt.value = catId; opt.textContent = catName;
            uploadCategorySelect.appendChild(opt);
            
            const item = document.createElement('div');
            item.className = 'admin-list-item';
            item.innerHTML = `<span>${catName}</span>`;
            if (catId !== 'uncategorized') {
                const delBtn = document.createElement('button');
                delBtn.className = 'delete-btn'; delBtn.textContent = 'Delete';
                delBtn.dataset.catid = catId; delBtn.addEventListener('click', handleDeleteCategory);
                
                const controls = document.createElement('div');
                controls.className = 'item-controls';
                controls.appendChild(delBtn);
                item.appendChild(controls);
            }
            adminCategoryList.appendChild(item);
        }
        
        for (const [bid, meta] of Object.entries(books)) {
            const item = document.createElement('div');
            item.className = 'admin-list-item';
            item.innerHTML = `<div><span>${meta.display_name}</span><br><small>${bid}</small></div>`;
            
            const controls = document.createElement('div');
            controls.className = 'item-controls';
            
            if (!meta.is_scanned) {
                const scanBtn = document.createElement('button');
                scanBtn.className = 'scan-btn'; scanBtn.textContent = 'Scan';
                scanBtn.onclick = () => handleScanBook(bid, scanBtn); // Use arrow function wrapper
                controls.appendChild(scanBtn);
            }
            
            const editBtn = document.createElement('button');
            editBtn.className = 'edit-btn'; editBtn.textContent = 'Edit';
            editBtn.onclick = () => handleEditBookName(bid); // Use arrow function wrapper
            controls.appendChild(editBtn);

            const delBtn = document.createElement('button');
            delBtn.className = 'delete-btn'; delBtn.textContent = 'Delete';
            delBtn.onclick = () => handleDeleteBook(bid); // Use arrow function wrapper
            controls.appendChild(delBtn);

            item.appendChild(controls);
            adminBookList.appendChild(item);
        }
    }

    async function handleAddCategory(e) { e.preventDefault(); if (!newCatNameInput.value || !newCatIdInput.value) return; showLoader("Adding..."); await fetch(`${API_URL}/category`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({category_id: newCatIdInput.value, display_name: newCatNameInput.value}) }); newCatNameInput.value = ''; newCatIdInput.value = ''; await refreshLibraryData(); hideLoader(); }
    async function handleDeleteCategory(e) { 
        const catId = (typeof e === 'string') ? e : e.target.dataset.catid;
        if(!confirm("Delete category?")) return; 
        showLoader("Deleting..."); await fetch(`${API_URL}/category/${catId}`, { method: 'DELETE' }); await refreshLibraryData(); hideLoader(); 
    }
    async function handleUploadBook(e) { e.preventDefault(); if(!uploadFileInput.files[0]) return; showLoader("Uploading..."); const fd = new FormData(); fd.append('display_name', uploadDisplayName.value); fd.append('category_id', uploadCategorySelect.value); fd.append('file', uploadFileInput.files[0]); await fetch(`${API_URL}/upload`, { method: 'POST', body: fd }); adminUploadForm.reset(); await refreshLibraryData(); hideLoader(); }
    async function handleEditBookName(bid) { 
        // Support direct ID (from arrow func) or event
        const bookId = (typeof bid === 'string') ? bid : bid.target.dataset.bookid;
        const newName = prompt("New name:", globalLibraryData.books[bookId].display_name); 
        if(newName) { showLoader("Updating..."); await fetch(`${API_URL}/book-display-name`, { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({book_id: bookId, new_display_name: newName})}); await refreshLibraryData(); hideLoader(); } 
    }
    async function handleScanBook(bid, btn) { 
        const bookId = (typeof bid === 'string') ? bid : bid.target.dataset.bookid;
        if(!confirm("Start long scan?")) return; if(btn) btn.disabled = true; showLoader("Scanning..."); try { const res = await fetch(`${API_URL}/scan-book/${bookId}`, { method: 'POST' }); if(!res.ok) throw new Error((await res.json()).detail); alert("Scan started!"); await refreshLibraryData(); } catch(e) { alert(e.message); if(btn) btn.disabled = false; } finally { hideLoader(); } 
    }
    async function handleDeleteBook(bid) { 
        const bookId = (typeof bid === 'string') ? bid : bid.target.dataset.bookid;
        if(!confirm("Delete book?")) return; showLoader("Deleting..."); await fetch(`${API_URL}/book/${bookId}`, { method: 'DELETE' }); await refreshLibraryData(); hideLoader(); 
    }

    // --- 12. EVENTS ---
    try {
        if(mobileSidebarToggle) {
            mobileSidebarToggle.addEventListener('click', () => {
                sidebarContainer.classList.toggle('active');
                sidebarOverlay.classList.toggle('active');
            });
            sidebarOverlay.addEventListener('click', () => {
                sidebarContainer.classList.remove('active');
                sidebarOverlay.classList.remove('active');
            });
        }
        backToSelectionBtn.addEventListener('click', () => {
            showMainView('selection');
            localStorage.removeItem('lastBookId'); localStorage.removeItem('lastTab');
            sidebarContainer.classList.remove('active'); sidebarOverlay.classList.remove('active');
        });
        langSwitcherBtn.addEventListener('click', toggleLanguage);
        adminPageBtn.addEventListener('click', () => showMainView('admin'));
        backToLibraryBtn.addEventListener('click', () => showMainView('selection'));
        
        tabButtons.ask.addEventListener('click', () => showLearningTab('ask'));
        tabButtons.summary.addEventListener('click', () => showLearningTab('summary'));
        tabButtons.read.addEventListener('click', () => showLearningTab('read'));
        tabButtons.test.addEventListener('click', () => showLearningTab('test'));
        
        pagePrevBtn.addEventListener('click', () => { if(currentPage > 1) fetchPage(currentPage-1); });
        pageNextBtn.addEventListener('click', () => { if(currentPage < totalPages) fetchPage(currentPage+1); });
        
        chatSendBtn.addEventListener('click', () => { if(chatTextInput.value) { handleRAGCommand(chatTextInput.value); chatTextInput.value=''; } });
        chatTextInput.addEventListener('keypress', (e) => { if(e.key==='Enter') chatSendBtn.click(); });
        chatVoiceBtn.addEventListener('click', () => isChatBotListening ? stopChatListening() : startChatListening());
        
        document.getElementById('tts-controls').addEventListener('click', (e) => {
            if (e.target.classList.contains('speed-btn')) {
                currentPlaybackRate = parseFloat(e.target.dataset.speed);
                document.querySelectorAll('.speed-btn').forEach(b => b.classList.toggle('active', b === e.target));
                if (currentAudio) currentAudio.playbackRate = currentPlaybackRate;
            }
        });
        
        addCategoryForm.addEventListener('submit', handleAddCategory);
        adminUploadForm.addEventListener('submit', handleUploadBook);
        window.addEventListener('keydown', (e) => { if(e.key === '~') toggleLanguage(); });
    } catch(e) { console.error(e); }

    // --- 13. INIT ---
    async function refreshLibraryData() {
        try {
            const res = await fetch(`${API_URL}/library`);
            if(!res.ok) throw new Error();
            globalLibraryData = await res.json();
            populateAllPages();
        } catch(e) { console.error("Lib error", e); }
    }
    function populateAllPages() {
        populateSelectionPage();
        if(currentView === 'admin') populateAdminPage(); // Refresh admin if active
        filterBooksByCategory('all');
    }
    async function initializeApp() {
        showLoader("Init...");
        const savedLang = localStorage.getItem('lastLang') || 'en-US';
        setLanguage(savedLang);
        await refreshLibraryData();
        const lastBookId = localStorage.getItem('lastBookId');
        const lastTab = localStorage.getItem('lastTab');
        if (lastBookId && globalLibraryData.books[lastBookId]) {
            selectBook(lastBookId);
            if (lastTab) showLearningTab(lastTab);
        } else {
            showMainView('selection');
        }
        hideLoader();
    }
    
    initializeApp();
});