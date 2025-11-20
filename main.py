import os
import uvicorn
import sys
import re
import io
import time
import fitz  # PyMuPDF
import chromadb
import google.generativeai as genai # No more Ollama
import shutil
import json
from dotenv import load_dotenv
from pydantic import BaseModel
from fastapi import FastAPI, HTTPException, status, UploadFile, File, BackgroundTasks, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from typhoon_ocr import ocr_document
from langchain_text_splitters import RecursiveCharacterTextSplitter

# --- gTTS Imports ---
from gtts import gTTS

# --- 1. Setup & Config ---
print("Server starting...")
load_dotenv()

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
)

# --- 2. Model & DB Config ---
EMBEDDING_MODEL = "models/text-embedding-004"

# --- NEW: Global Scanning Lock ---
IS_SCANNING = False

# --- Cache Directories ---
INGEST_PAGE_CACHE_DIR = "ingest_page_cache"
INGEST_SUMMARY_CACHE_DIR = "ingest_summary_cache"
UPLOAD_DIR = "uploaded_books"
LIBRARY_FILE = "library.json"
QUESTION_BANK_CACHE_DIR = "question_bank_cache"

for dir_path in [
    INGEST_PAGE_CACHE_DIR, 
    INGEST_SUMMARY_CACHE_DIR, 
    UPLOAD_DIR, 
    QUESTION_BANK_CACHE_DIR 
]:
    if not os.path.exists(dir_path):
        os.makedirs(dir_path)

# --- Library State Management ---
library_data = {
    "categories": {
        "uncategorized": "Uncategorized"
    },
    "books": {}
}

def load_library():
    global library_data
    if os.path.exists(LIBRARY_FILE):
        try:
            with open(LIBRARY_FILE, 'r', encoding='utf-8') as f:
                library_data = json.load(f)
            print("library.json loaded.")
        except Exception as e:
            print(f"Warning: Could not load library.json. Using default. Error: {e}")
    else:
        print("library.json not found, creating a new one.")
        save_library()

def save_library():
    global library_data
    try:
        with open(LIBRARY_FILE, 'w', encoding='utf-8') as f:
            json.dump(library_data, f, indent=4)
        print("library.json saved.")
    except Exception as e:
        print(f"CRITICAL: Could not save library.json! Error: {e}")

# --- End Library State ---


gemini_chat_model = None
try:
    GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
    if not GOOGLE_API_KEY:
        raise Exception("GOOGLE_API_KEY not found in .env file")
    genai.configure(api_key=GOOGLE_API_KEY)
    gemini_chat_model = genai.GenerativeModel('models/gemini-2.5-flash')
    print(f"Gemini ({gemini_chat_model.model_name}) loaded.")
    genai.embed_content(model=EMBEDDING_MODEL, content="Test", task_type="RETRIEVAL_QUERY")
    print(f"Gemini Embedding Model ({EMBEDDING_MODEL}) loaded.")
except Exception as e:
    print(f"!!! Warning: Gemini API failed. Error: {e} !!!")

try:
    client = chromadb.PersistentClient(path="./chroma_db") 
    collection = client.get_or_create_collection(name="book_library")
    print("ChromaDB connected.")
except Exception as e:
    print(f"FATAL: ChromaDB connection failed: {e}")
    sys.exit(1)

chat_cache = {}

@app.on_event("startup")
def on_startup():
    load_library()
    print("Server is ready.")

# --- 3. INGEST LOGIC ---
CONTROL_CHAR_REGEX = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]')
REPLACEMENT_CHAR = '\ufffd'
def is_text_corrupted_v3(text, control_char_threshold=0.05, replacement_char_threshold=0.05):
    if not text or len(text) < 20: return False
    control_chars = CONTROL_CHAR_REGEX.findall(text)
    control_char_ratio = len(control_chars) / len(text)
    if control_char_ratio > control_char_threshold: return True
    replacement_chars = text.count(REPLACEMENT_CHAR)
    replacement_char_ratio = replacement_chars / len(text)
    if replacement_char_ratio > replacement_char_threshold: return True
    return False

def embed_text_batch(texts_to_embed):
    print(f"Embedding batch of {len(texts_to_embed)} chunks with Gemini...")
    try:
        result = genai.embed_content(
            model=EMBEDDING_MODEL,
            content=texts_to_embed,
            task_type="RETRIEVAL_DOCUMENT"
        )
        return result['embedding']
    except Exception as e:
        print(f"Error embedding batch with Gemini: {e}")
        return [None] * len(texts_to_embed)

def process_and_ingest_pdf(file_path: str, book_id: str, category_id: str, display_name: str):
    print(f"\n--- BACKGROUND INGEST START: {book_id} ---")
    
    book_page_cache_dir = os.path.join(INGEST_PAGE_CACHE_DIR, book_id)
    summary_cache_path = os.path.join(INGEST_SUMMARY_CACHE_DIR, f"{book_id}.txt")
    if not os.path.exists(book_page_cache_dir):
        os.makedirs(book_page_cache_dir)
        
    try:
        doc = fitz.open(file_path)
        full_text_pages = [] 
        
        for page_num, page in enumerate(doc):
            page_index = page_num + 1
            print(f"    Ingesting page {page_index}/{len(doc)}...")
            text = page.get_text()
            
            if is_text_corrupted_v3(text):
                print(f"    Page {page_index} is corrupted. Calling Typhoon API.")
                try:
                    ocr_text = ocr_document(
                        pdf_or_image_path=file_path, 
                        page_num=page_index
                    )
                    text_to_use = ocr_text
                    print(f"    API success. Waiting 3.1s...")
                    time.sleep(3.1)
                except Exception as e:
                    print(f"    Typhoon API failed: {e}. Skipping page.")
                    text_to_use = ""
            else:
                text_to_use = text
            
            page_cache_path = os.path.join(book_page_cache_dir, f"page_{page_index}.txt")
            with open(page_cache_path, 'w', encoding='utf-8') as f:
                f.write(text_to_use)
            
            full_text_pages.append(text_to_use)
        
        doc.close()
        
        full_document_text = "\n\n".join(full_text_pages)
        with open(summary_cache_path, 'w', encoding='utf-8') as f:
            f.write(full_document_text)
        print(f"Full text cache saved to {summary_cache_path}")

        print("Connecting to ChromaDB for RAG ingest...")
        ingest_client = chromadb.PersistentClient(path="./chroma_db")
        ingest_collection = ingest_client.get_or_create_collection(name="book_library")
        print(f"Deleting old RAG entries for {book_id}...")
        ingest_collection.delete(where={"book_id": book_id})

        text_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=100)
        chunks = text_splitter.split_text(full_document_text)
        if not chunks:
            print(f"Warning: No text extracted from {book_id}. Skipping RAG.")
            return

        print(f"Embedding batch of {len(chunks)} chunks for RAG...")
        embeddings = embed_text_batch(chunks)
        
        valid_data = [(emb, doc, f"{book_id}_chunk_{i}", {"book_id": book_id, "chunk_num": i})
                        for i, (emb, doc) in enumerate(zip(embeddings, chunks)) if emb is not None]
        if not valid_data:
            print("Error: No valid RAG embeddings.")
            return
            
        ingest_collection.add(
            embeddings=[d[0] for d in valid_data],
            documents=[d[1] for d in valid_data],
            metadatas=[d[3] for d in valid_data],
            ids=[d[2] for d in valid_data]
        )
        
        global library_data
        if category_id not in library_data["categories"]:
            category_id = "uncategorized"
            
        library_data["books"][book_id] = {
            "display_name": display_name,
            "category": category_id
        }
        save_library()
        
        print(f"--- BACKGROUND INGEST COMPLETE: {book_id} ---")

    except Exception as e:
        print(f"!!! FATAL INGEST ERROR for {book_id}: {e} !!!")
    finally:
        print(f"Ingest complete. Original PDF retained at {file_path}")


# --- 4. API Endpoints (Core App) ---

class ChatQuery(BaseModel):
    query: str
    book_id: str
    lang: str

class TTSRequest(BaseModel):
    text: str
    lang: str

def retrieve_chunks(query, book_id, n_results=15):
    try:
        print(f"Embedding query with Gemini: {query[:30]}...")
        result = genai.embed_content(
            model=EMBEDDING_MODEL,
            content=query,
            task_type="RETRIEVAL_QUERY"
        )
        query_embedding = result['embedding']
        
        results = collection.query(
            query_embeddings=[query_embedding],
            n_results=n_results,
            where={"book_id": book_id}
        )
        print(f"ChromaDB found {len(results['documents'][0])} chunks.")
        return results['documents'][0] if results['documents'] else []
    except Exception as e:
        print(f"Error retrieving chunks: {e}")
        return []

def get_dual_output_prompt(query, context_chunks, lang):
    context = "\n---\n".join(context_chunks)
    
    if lang == 'th-TH':
        return f"""
        คุณคืออาจารย์ผู้เชี่ยวชาญที่กำลังสอนหนังสือเล่มนี้
        **ภารกิจ:** ตอบคำถามของนักเรียน โดยใช้ "เนื้อหาที่คัดมา (CONTEXT)" เป็นหลัก แต่คุณสามารถใช้ความรู้ทั่วไปเสริมได้เพื่อให้เข้าใจง่ายขึ้น
        
        **CONTEXT (เนื้อหาจากหนังสือ):**
        {context}
        ---
        **QUESTION (คำถามนักเรียน):**
        {query}
        
        **กฎการตอบ (คิดแบบครู):**
        1. **ถ้าคำตอบอยู่ใน CONTEXT:** อธิบายให้ชัดเจน ยกตัวอย่างจากเนื้อหา และตอบอย่างมั่นใจ
        2. **ถ้าคำตอบไม่อยู่ใน CONTEXT โดยตรง:**
           - ห้ามตอบว่า "ไม่ทราบ" หรือ "ไม่มีข้อมูล"
           - ให้ตอบโดยใช้ **ความรู้ทั่วไปของคุณ** อธิบายคอนเซปต์นั้นๆ ให้ผู้ใช้เข้าใจ
           - แต่ต้องบอกต่อท้ายว่า "อย่างไรก็ตาม ในเนื้อหาที่ฉันอ่านมาตอนนี้ยังไม่มีรายละเอียดเจาะจงเกี่ยวกับส่วนนี้ของหนังสือ"
           - พยายามเชื่อมโยงสิ่งที่ผู้ใช้ถาม เข้ากับหัวข้อที่ใกล้เคียงที่สุดใน CONTEXT (เช่น "คุณอาจจะหมายถึงเรื่อง [หัวข้อใน Context] หรือเปล่า?")
        3. **สไตล์การตอบ:** เป็นกันเอง เหมือนครูสอนศิษย์ ไม่ใช่หุ่นยนต์ กระตือรือร้นที่จะช่วย

        **รูปแบบ JSON ที่ต้องตอบกลับ (ห้ามเปลี่ยนโครงสร้าง):**
        {{
            "structured": "คำตอบแบบละเอียด จัดรูปแบบสวยงามด้วย Markdown (ใช้หัวข้อ ##, ตัวหนา **bold**, รายการ *)",
            "speech": "คำตอบเดียวกันที่เขียนใหม่เป็นภาษาพูด ย่อหน้าเดียว สั้นกระชับ เป็นธรรมชาติ (สำหรับอ่านออกเสียง)"
        }}
        """
    else:
        return f"""
        You are an expert professor teaching this specific book.
        **Mission:** Answer the student's question. Prioritize the provided "CONTEXT", but use your general knowledge to bridge gaps.

        **CONTEXT (Excerpts from the book):**
        {context}
        ---
        **QUESTION:**
        {query}

        **Thinking Process (Act like a Teacher):**
        1. **Direct Match:** If the answer is in the CONTEXT, explain it clearly using examples from the text.
        2. **No Direct Match:**
           - DO NOT say "I don't know" or "Context missing".
           - Instead, explain the concept using your **general knowledge**.
           - Then, gently add: "However, the specific details for this section weren't in the excerpts I just read."
           - Try to infer what they meant. Look at the CONTEXT and suggest: "Did you perhaps mean to ask about [Related Topic found in Context]?"
        3. **Tone:** Helpful, educational, and encouraging.

        **Required JSON Output:**
        {{
            "structured": "A detailed answer formatted in clean Markdown (Use ## Headings, **bold**, * lists).",
            "speech": "The same answer rewritten as a single, natural-sounding spoken paragraph (for TTS)."
        }}
        """

def get_smart_fallback_prompt(query, lang):
    if lang == 'th-TH':
        structured_answer = "ขออภัยค่ะ ข้อมูลนี้ไม่ได้อยู่ในเนื้อหาที่ให้มา"
        speech_answer = "ขออภัยค่ะ ข้อมูลนี้ไม่ได้อยู่ในเนื้อหาที่ให้มา"
    else:
        structured_answer = "I'm sorry, that information is not in the provided text."
        speech_answer = "I'm sorry, that information is not in the provided text."
        
    return {
        "structured": structured_answer,
        "speech": speech_answer
    }


# --- API 1: Root ---
@app.get("/")
def read_root():
    return {"status": "Accessible Library API is running"}

# --- API 2: The "Ask" (RAG) Chatbot ---
@app.post("/chat")
def final_chat(query: ChatQuery):
    print(f"\n--- RAG Chat Query ---")
    cache_key = f"{query.lang}::{query.book_id}::{query.query}"
    if cache_key in chat_cache:
        print("<<< Level 1: Returning from Cache >>>")
        if isinstance(chat_cache[cache_key], dict) and "structured" in chat_cache[cache_key]:
             return chat_cache[cache_key]
    
    print("... Retrieving context (Gemini Embeddings)...")
    context_chunks = retrieve_chunks(query.query, query.book_id)
    
    if not context_chunks:
        print("!!! No context found. Using static fallback. !!!")
        return get_smart_fallback_prompt(query.query, query.lang)
    else:
        print(f"Found {len(context_chunks)} chunks. Using Dual-Output RAG prompt.")
        prompt = get_dual_output_prompt(query.query, context_chunks, query.lang)

    try:
        print(">>> Level 2: Calling Gemini Flash API (Chat) >>>")
        response = gemini_chat_model.generate_content(prompt)
        
        print("Parsing LLM JSON response...")
        json_text = re.sub(r"^```json\s*|\s*```$", "", response.text.strip(), flags=re.MULTILINE)
        answer_json = json.loads(json_text)
        
        chat_cache[cache_key] = answer_json
        print(f"Gemini Answer (Structured): {answer_json['structured'][:50]}...")
        
        return answer_json
        
    except Exception as e:
        print(f"!!! LLM or JSON Parsing Failed: {e} !!!")
        print(f"Failed Response Text: {response.text if 'response' in locals() else 'N/A'}")
        error_json = {"structured": "Sorry, an error occurred on the server.", "speech": "Sorry, an error occurred on the server."}
        if query.lang == 'th-TH':
            error_json = {"structured": "ขออภัยค่ะ เกิดข้อผิดพลาดบนเซิร์ฟเวอร์", "speech": "ขออภัยค่ะ เกิดข้อผิดพลาดบนเซิร์ฟเวอร์"}
        return error_json

# --- API 3: The "Read" Mode (Get Page) ---
@app.get("/book-page/{book_id}/{page_num}")
async def get_book_page(book_id: str, page_num: int):
    page_path = os.path.join(INGEST_PAGE_CACHE_DIR, book_id, f"page_{page_num}.txt")
    page_dir = os.path.join(INGEST_PAGE_CACHE_DIR, book_id)
    
    if not os.path.exists(page_path):
        raise HTTPException(status_code=404, detail="Page not found.")
    
    try:
        with open(page_path, 'r', encoding='utf-8') as f:
            text = f.read()
        
        total_pages = len([name for name in os.listdir(page_dir) if name.startswith("page_") and name.endswith(".txt")])
        
        return {"page_num": page_num, "total_pages": total_pages, "text": text}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- API 4: "Smart Summary" Helper Function (V2 - Safer) ---
def get_text_summary_chunks(full_book_text: str) -> str:
    SAFE_CHUNK_SIZE = 200000 
    
    if len(full_book_text) < SAFE_CHUNK_SIZE: 
        print("Text is short. Returning full text for summarization.")
        return full_book_text

    print("Text is long. Starting 'Map-Reduce' summarization...")
    
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=SAFE_CHUNK_SIZE, 
        chunk_overlap=5000
    )
    chunks = text_splitter.split_text(full_book_text)
    
    summaries = []
    print(f"Generating {len(chunks)} summary chunks...")
    
    for i, chunk in enumerate(chunks):
        print(f"  Summarizing chunk {i+1}/{len(chunks)}...")
        try:
            prompt = f"Summarize the key events, people, and concepts in this section of the book: {chunk}"
            response = gemini_chat_model.generate_content(prompt)
            summaries.append(response.text)
        except Exception as e:
            print(f"  Warning: Could not summarize chunk {i+1}. Error: {e}")
            pass 
            
    if not summaries:
        print("  Error: No summaries were generated. Returning truncated text as fallback.")
        return full_book_text[:SAFE_CHUNK_SIZE] 

    combined_summary = "\n\n".join(summaries)
    
    if len(combined_summary) > SAFE_CHUNK_SIZE:
        print(f"  Combined summaries are still long ({len(combined_summary)}). Summarizing again...")
        try:
            prompt = f"Summarize the following collection of summaries into one cohesive text: {combined_summary}"
            response = gemini_chat_model.generate_content(prompt)
            final_summary = response.text
            print(f"  Final 'summary of summaries' created. Length: {len(final_summary)} chars.")
            return final_summary
        except Exception as e:
            print(f"  Warning: Could not summarize the combined summaries. Error: {e}")
            return combined_summary
    else:
        print(f"  All chunks summarized. Combined length: {len(combined_summary)} chars.")
        return combined_summary


# --- API 5: The "Summary" Generator (MODIFIED) ---
@app.post("/get-book-summary")
async def get_book_summary(query: ChatQuery):
    print(f"--- Book Summary Request: {query.book_id} ---")

    summary_cache_path = os.path.join(INGEST_SUMMARY_CACHE_DIR, f"{query.book_id}_{query.lang}.summary.txt")
    if os.path.exists(summary_cache_path):
        print(f"Returning summary from cache: {summary_cache_path}")
        try:
            with open(summary_cache_path, 'r', encoding='utf-8') as f:
                summary = f.read()
            return {"answer": summary}
        except Exception as e:
            print(f"Warning: Could not read summary cache. Regenerating. Error: {e}")
    
    print("No summary cache found. Generating new summary...")
    full_text_cache_path = os.path.join(INGEST_SUMMARY_CACHE_DIR, f"{query.book_id}.txt")
    
    if not os.path.exists(full_text_cache_path):
        raise HTTPException(status_code=404, detail="Book full text cache file not found.")
    
    try:
        with open(full_text_cache_path, 'r', encoding='utf-8') as f:
            full_book_text = f.read()
        
        text_to_summarize = get_text_summary_chunks(full_book_text)

        prompt = f"Provide a concise, 3-paragraph final summary of the following book text (which may be a summary of chunks): {text_to_summarize}"
        
        print("Sending final summary request to Gemini...")
        response = gemini_chat_model.generate_content(prompt)
        summary = response.text
        
        if query.lang == 'th-TH':
            print("Translating summary to Thai...")
            translate_prompt = f"Translate the following summary into Thai: {summary}"
            translate_response = gemini_chat_model.generate_content(translate_prompt)
            summary = translate_response.text

        try:
            with open(summary_cache_path, 'w', encoding='utf-8') as f:
                f.write(summary)
            print(f"Saved new summary to cache: {summary_cache_path}")
        except Exception as e:
            print(f"Warning: Could not save summary to cache. Error: {e}")

        return {"answer": summary}
        
    except Exception as e:
        print(f"!!! Summary Failed: {e} !!!")
        raise HTTPException(status_code=500, detail=str(e))


# --- API 6: QUESTION BANK LOGIC (MODIFIED for Language) ---

def generate_question_bank_task(book_id: str, lang: str):
    print(f"---BACKGROUND: Starting Question Bank Generation for {book_id} (Lang: {lang}) ---")
    bank_cache_path = os.path.join(QUESTION_BANK_CACHE_DIR, f"{book_id}_{lang}.json")
    
    if os.path.exists(bank_cache_path):
        print(f"---BACKGROUND: Cache file already exists. Skipping. ---")
        return

    full_text_cache_path = os.path.join(INGEST_SUMMARY_CACHE_DIR, f"{book_id}.txt")
    if not os.path.exists(full_text_cache_path):
        print(f"---BACKGROUND: FAILED. Full text cache not found for {book_id} ---")
        return
        
    try:
        with open(full_text_cache_path, 'r', encoding='utf-8') as f:
            full_book_text = f.read()
            
        print(f"---BACKGROUND: Generating context for Question Bank... ---")
        book_context = get_text_summary_chunks(full_book_text)
        print(f"---BACKGROUND: Context generated. Length: {len(book_context)} chars. ---")

        if lang == 'th-TH':
            lang_prompt = "The questions, options, and difficulty must be in Thai (ภาษาไทย)."
        else:
            lang_prompt = "The questions, options, and difficulty must be in English."

        prompt = f"""
        You are an expert curriculum designer. Read the following text, which is a comprehensive summary of a book.
        Your Task: Generate a comprehensive question bank of 50 multiple-choice questions based *only* on this text.
        The questions must cover a wide range of topics.
        Include a mix of difficulties: 20 easy, 20 medium, and 10 hard.
        {lang_prompt}
        
        CRITICAL: You MUST return your answer as a JSON array *only*.
        Each object in the array must have this *exact* structure:
        {{
            "question": "The text of the question...",
            "options": ["Option A", "Option B", "Option C", "Option D"],
            "correctAnswerIndex": 2,
            "difficulty": "easy" 
        }}

        BOOK TEXT (SUMMARY):
        {book_context}
        """
        
        print(f"---BACKGROUND: Sending large prompt to Gemini for {book_id}... This will take minutes. ---")
        response = gemini_chat_model.generate_content(prompt)
        
        json_text = re.sub(r"^```json\s*|\s*```$", "", response.text.strip(), flags=re.MULTILINE)
        
        print(f"---BACKGROUND: Parsing question bank JSON for {book_id}... ---")
        question_bank_data = json.loads(json_text)
        
        with open(bank_cache_path, 'w', encoding='utf-8') as f:
            json.dump(question_bank_data, f, indent=4, ensure_ascii=False) # ensure_ascii=False for Thai
        print(f"---BACKGROUND: SUCCESS! Saved new question bank to cache: {bank_cache_path} ---")
            
    except Exception as e:
        print(f"---BACKGROUND: !!! FATAL ERROR Generating Question Bank for {book_id}: {e} !!!")
        print(f"Failed Response Text: {response.text if 'response' in locals() else 'N/A'}")

@app.post("/generate-question-bank/{book_id}/{lang}")
async def start_question_bank_generation(book_id: str, lang: str, background_tasks: BackgroundTasks):
    bank_cache_path = os.path.join(QUESTION_BANK_CACHE_DIR, f"{book_id}_{lang}.json")
    if os.path.exists(bank_cache_path):
        return {"message": "Question bank already exists."}
        
    print(f"Adding question bank generation task for {book_id} (Lang: {lang}) to background.")
    background_tasks.add_task(generate_question_bank_task, book_id, lang)
    
    return {"message": "Question bank generation has started. This may take 5-10 minutes."}


@app.get("/get-question-bank/{book_id}/{lang}")
async def get_question_bank(book_id: str, lang: str):
    bank_cache_path = os.path.join(QUESTION_BANK_CACHE_DIR, f"{book_id}_{lang}.json")
    
    if not os.path.exists(bank_cache_path):
        raise HTTPException(status_code=404, detail="Question bank has not been generated yet.")
        
    try:
        with open(bank_cache_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return data
    except Exception as e:
        print(f"Error reading question bank cache: {e}")
        raise HTTPException(status_code=500, detail="Could not read question bank cache file.")


# --- API 7: Text-to-Speech (TTS) using gTTS ---
@app.post("/synthesize-speech")
async def synthesize_speech(request: TTSRequest):
    print(f"--- gTTS Request: {request.text[:30]}... Lang: {request.lang} ---")
    
    try:
        lang_code = request.lang.split('-')[0]
        
        tts = gTTS(text=request.text, lang=lang_code)
        
        audio_buffer = io.BytesIO()
        tts.write_to_fp(audio_buffer)
        audio_buffer.seek(0)
        
        print("--- gTTS Success, streaming audio back ---")
        return StreamingResponse(audio_buffer, media_type="audio/mpeg")

    except Exception as e:
        print(f"!!! gTTS Failed: {e} !!!")
        raise HTTPException(status_code=500, detail=f"gTTS failed: {e}")

# --- 8. ADMIN API ENDPOINTS ---

@app.get("/library")
def get_library_data():
    global library_data
    books_with_status = {}
    for book_id, metadata in library_data["books"].items():
        pdf_path = os.path.join(UPLOAD_DIR, book_id)
        metadata["is_scanned"] = not os.path.exists(pdf_path)
        books_with_status[book_id] = metadata
        
    return JSONResponse(content={
        "categories": library_data["categories"],
        "books": books_with_status
    })

@app.post("/upload")
async def upload_book(
    background_tasks: BackgroundTasks, 
    category_id: str = Form(...),
    display_name: str = Form(...),
    file: UploadFile = File(...)
):
    if not file.filename.endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed.")
    
    file_path = os.path.join(UPLOAD_DIR, file.filename)
    book_id = file.filename
    
    if book_id in library_data["books"]:
        raise HTTPException(status_code=400, detail=f"Book ID '{book_id}' already exists. Delete it first to re-upload.")

    try:
        with open(file_path, "wb") as buffer:
            buffer.write(await file.read())
        print(f"File saved to: {file_path}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not save file: {e}")
        
    print(f"Adding ingest job for {book_id} to background tasks.")
    background_tasks.add_task(process_and_ingest_pdf, file_path, book_id, category_id, display_name)
    
    return {"message": f"Upload successful. '{book_id}' is being ingested. This may take 5-15 minutes."}

class CategoryRequest(BaseModel):
    category_id: str
    display_name: str

@app.post("/category")
def add_category(request: CategoryRequest):
    global library_data
    cat_id = request.category_id.lower().strip().replace(" ", "-")
    if not cat_id:
        raise HTTPException(status_code=400, detail="Category ID cannot be empty.")
    if cat_id in library_data["categories"]:
        raise HTTPException(status_code=400, detail="Category ID already exists.")
    
    library_data["categories"][cat_id] = request.display_name
    save_library()
    return JSONResponse(content=library_data)

@app.delete("/category/{category_id}")
def delete_category(category_id: str):
    global library_data
    if category_id == "uncategorized":
        raise HTTPException(status_code=400, detail="Cannot delete the 'uncategorized' category.")
    if category_id not in library_data["categories"]:
        raise HTTPException(status_code=404, detail="Category not found.")
    
    for book_id, metadata in library_data["books"].items():
        if metadata["category"] == category_id:
            metadata["category"] = "uncategorized"
            
    del library_data["categories"][category_id]
    save_library()
    return JSONResponse(content=library_data)

class BookEditRequest(BaseModel):
    book_id: str
    new_display_name: str

@app.put("/book-display-name")
def edit_book_name(request: BookEditRequest):
    global library_data
    if request.book_id not in library_data["books"]:
        raise HTTPException(status_code=404, detail="Book not found.")
    
    library_data["books"][request.book_id]["display_name"] = request.new_display_name
    save_library()
    return JSONResponse(content=library_data)
    
# --- API 13: Full-Book Scan (Now without Gemini Reformatting) ---

def scan_book_task(book_id: str):
    global IS_SCANNING
    print(f"---BACKGROUND: Starting FULL SCAN for {book_id} ---")
    
    original_pdf_path = os.path.join(UPLOAD_DIR, book_id)
    book_page_cache_dir = os.path.join(INGEST_PAGE_CACHE_DIR, book_id)
    summary_cache_path = os.path.join(INGEST_SUMMARY_CACHE_DIR, f"{book_id}.txt")
    
    if not os.path.exists(original_pdf_path):
        print(f"---BACKGROUND: FAILED. Original PDF not found: {original_pdf_path} ---")
        IS_SCANNING = False
        return
        
    try:
        doc = fitz.open(original_pdf_path)
        total_pages = len(doc)
        print(f"---BACKGROUND: PDF opened. Found {total_pages} pages. ---")
        full_text_pages = [] 

        for page_num, page in enumerate(doc):
            page_index = page_num + 1
            print(f"    Scanning page {page_index}/{total_pages}...")
            
            # --- STEP 1: Get clean text from Typhoon ---
            try:
                ocr_text = ocr_document(
                    pdf_or_image_path=original_pdf_path, 
                    page_num=page_index
                )
                text_to_use = ocr_text # This is already Markdown
                print(f"API success. Waiting 3.1s...")
                time.sleep(3.1)
            except Exception as e:
                print(f"Typhoon API failed for page {page_index}: {e}. Saving blank. !!!")
                text_to_use = ""
            
            # --- STEP 2: REMOVED. We no longer call Gemini to reformat. ---

            # --- STEP 3: Save the (now Markdown) text to cache ---
            page_cache_path = os.path.join(book_page_cache_dir, f"page_{page_index}.txt")
            with open(page_cache_path, 'w', encoding='utf-8') as f:
                f.write(text_to_use)
            
            full_text_pages.append(text_to_use)
        
        doc.close()
        
        full_document_text = "\n\n".join(full_text_pages)
        with open(summary_cache_path, 'w', encoding='utf-8') as f:
            f.write(full_document_text)
        print(f"---BACKGROUND: Full text cache overwritten with Markdown text. ---")

        print(f"---BACKGROUND: Clearing stale cache files for {book_id}... ---")
        for filename in os.listdir(INGEST_SUMMARY_CACHE_DIR):
             if filename.startswith(book_id) and filename.endswith(".summary.txt"):
                os.remove(os.path.join(INGEST_SUMMARY_CACHE_DIR, filename))
                print(f"  Deleted generated summary: {filename}")
        
        for filename in os.listdir(QUESTION_BANK_CACHE_DIR):
            if filename.startswith(book_id):
                os.remove(os.path.join(QUESTION_BANK_CACHE_DIR, filename))
                print(f"  Deleted question bank: {filename}")

        os.remove(original_pdf_path)
        print(f"---BACKGROUND: SUCCESS! Full scan complete. Original PDF deleted. ---")

    except Exception as e:
        print(f"---BACKGROUND: !!! FATAL ERROR during full scan for {book_id}: {e} !!!")
    finally:
        IS_SCANNING = False


@app.post("/scan-book/{book_id}")
async def start_book_scan(book_id: str, background_tasks: BackgroundTasks):
    global IS_SCANNING
    if IS_SCANNING:
        raise HTTPException(status_code=429, detail="Server is already busy scanning another book. Please try again later.")
        
    original_pdf_path = os.path.join(UPLOAD_DIR, book_id)
    if not os.path.exists(original_pdf_path):
        raise HTTPException(status_code=404, detail="Original PDF not found. Cannot scan.")
        
    IS_SCANNING = True
    print(f"Adding full book scan task for {book_id} to background.")
    background_tasks.add_task(scan_book_task, book_id)
    
    return {"message": "Full book scan has started. This will take a long time and will reset all summaries and quizzes."}


@app.delete("/book/{book_id}")
def delete_book(book_id: str):
    global library_data
    if book_id not in library_data["books"]:
        raise HTTPException(status_code=404, detail="Book not found in library.")
    
    # 1. Delete from library.json
    del library_data["books"][book_id]
    save_library()
    
    # 2. Delete from ChromaDB
    try:
        collection.delete(where={"book_id": book_id})
        print(f"Deleted {book_id} from ChromaDB.")
    except Exception as e:
        print(f"Warning: Could not delete {book_id} from ChromaDB. {e}")

    # 3. Delete all cache files
    try:
        page_cache_dir = os.path.join(INGEST_PAGE_CACHE_DIR, book_id)
        if os.path.exists(page_cache_dir):
            shutil.rmtree(page_cache_dir)
            print(f"Deleted page cache for {book_id}.")
            
        summary_cache_file = os.path.join(INGEST_SUMMARY_CACHE_DIR, f"{book_id}.txt")
        if os.path.exists(summary_cache_file):
            os.remove(summary_cache_file)
            print(f"Deleted summary cache for {book_id}.")
            
        for filename in os.listdir(INGEST_SUMMARY_CACHE_DIR):
             if filename.startswith(book_id) and filename.endswith(".summary.txt"):
                os.remove(os.path.join(INGEST_SUMMARY_CACHE_DIR, filename))
                print(f"  Deleted generated summary: {filename}")
            
        for filename in os.listdir(QUESTION_BANK_CACHE_DIR):
            if filename.startswith(book_id):
                os.remove(os.path.join(QUESTION_BANK_CACHE_DIR, filename))
                print(f"  Deleted question bank: {filename}")
                
    except Exception as e:
        print(f"Warning: Could not delete cache files for {book_id}. {e}")
        
    # 4. Delete original PDF
    try:
        original_pdf_path = os.path.join(UPLOAD_DIR, book_id)
        if os.path.exists(original_pdf_path):
            os.remove(original_pdf_path)
            print(f"Deleted original PDF: {original_pdf_path}")
    except Exception as e:
        print(f"Warning: Could not delete original PDF. {e}")

    return JSONResponse(content=library_data)


# --- Run Server ---
if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)