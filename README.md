# 📄 PaperChat

> Chat with your research papers using AI. Upload any PDF and ask questions in natural language — powered by RAG, LangChain, OpenAI GPT-4, and Pinecone.

[![Live Demo](https://img.shields.io/badge/Live%20Demo-Visit%20Site-black?style=for-the-badge&logo=vercel)](https://paperchat-bixg7nbyg-merub-shaikhs-projects.vercel.app/)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://typescriptlang.org)
[![Next.js](https://img.shields.io/badge/Next.js-000000?style=for-the-badge&logo=next.js&logoColor=white)](https://nextjs.org)
[![OpenAI](https://img.shields.io/badge/OpenAI-412991?style=for-the-badge&logo=openai&logoColor=white)](https://openai.com)
[![Pinecone](https://img.shields.io/badge/Pinecone-000000?style=for-the-badge)](https://pinecone.io)

---

## 📌 Overview

PaperChat is a full-stack RAG (Retrieval-Augmented Generation) application that allows users to upload research papers and ask questions about them in natural language. Instead of reading through pages of dense academic text, users can get instant, accurate answers grounded in the paper's content.

Built as part of a research project at **Illinois Institute of Technology**, where qualitative research on assistive technology and mobility aids informed the design of accessible, user-centered interfaces.

---

## Features

- **📤 Drag & Drop Upload** — Upload any PDF research paper instantly
- **🧠 Semantic Search** — Finds relevant sections by meaning, not just keywords
- **💬 Conversational Q&A** — Ask questions in natural language
- **⚡ Fast Retrieval** — Sub-second responses using Pinecone vector database
- **🎯 Context-Aware** — GPT-4 answers grounded in your specific document
- **🌙 Dark Mode UI** — Modern ChatGPT-like interface
- **📱 Responsive Design** — Works on desktop and mobile
- **🔒 Secure** — Files processed in memory, not stored permanently

---

## Screenshots

### Upload Screen
![Upload Screen](./public/paperchat_upload.png)

### Chat Interface
![Chat Interface](./public/paperchat_chat.png)



---

## How It Works

PaperChat uses a **RAG (Retrieval-Augmented Generation)** pipeline:

```
📄 PDF Upload
     ↓
📝 Text Extraction       (LangChain PDFLoader)
     ↓
✂️  Chunking             (RecursiveCharacterTextSplitter)
     ↓                    chunk_size=1000, overlap=200
🔢 Embedding Generation  (OpenAI text-embedding-ada-002)
     ↓                    1536-dimensional vectors
🗄️  Vector Storage       (Pinecone - namespace per document)
     ↓
❓ User asks question
     ↓
🔍 Semantic Search       (Pinecone similarity search - top 6 chunks)
     ↓
🤖 Answer Generation     (GPT-4 + retrieved context)
     ↓
💡 Answer returned to user
```

---
## 📊 Evaluation Results

PaperChat was evaluated using **[RAGAS](https://docs.ragas.io/)** — the industry-standard RAG evaluation framework — measuring four metrics across 20 domain-specific questions on two accessibility research papers.

### 📐 Metrics Explained

| Metric | What It Measures | Target |
|--------|-----------------|--------|
| **Faithfulness** | Are answers grounded in retrieved chunks? Low score = hallucination | > 0.85 |
| **Answer Relevancy** | Do answers directly address the question asked? | > 0.85 |
| **Context Precision** | Are retrieved chunks actually relevant to the question? | > 0.85 |
| **Context Recall** | Did retrieval find all necessary information from the paper? | > 0.85 |


### 🔄 Iteration History — 5 Rounds of Improvement

The system was improved through **5 data-driven iterations**, each targeting a specific weakness identified by RAGAS scores:

| # | Change | Faithful | Relevancy | Precision | Recall | Key Finding |
|---|--------|----------|-----------|-----------|--------|-------------|
| 1 | Baseline | 0.650 | 0.463 | 0.964 | 0.850 | Retrieval strong, generation weak |
| 2 | Tightened system prompt | 0.859 | 0.709 | 0.968 | 0.850 | Faithfulness +32%, Relevancy +53% |
| 3 | Added answer format rules | 0.775 | 0.757 | 0.979 | 0.787 | Relevancy improved further |
| 4 | chunkSize 1000 → 500 | 0.909 | 0.750 | 0.961 | 0.733 | Faithfulness best, recall dropped |
| 5 | Retrieval k: 4 → 6 | **0.873** | **0.900** | **0.972** | **0.917** | All metrics above 0.85 ✅ |

> **Key Insight:** Chunk size and retrieval `k` are coupled parameters. Reducing chunk size improves faithfulness by providing cleaner context, but hurts recall because each chunk covers less content. Increasing `k` compensates by retrieving more chunks, recovering recall while maintaining precision gains. Final configuration: `chunkSize=500, k=6`.

### 🏆 Final Scores

Evaluated on 2 accessibility research papers:
- *"One Does Not Simply 'Mm-hmm': Exploring Backchanneling in the AAC Micro-Culture"* — ACM ASSETS '25
- *"Wheelchair Proxemics: Interpersonal Behaviour Between Pedestrians and Power Wheelchair Drivers"* — ACM VRST '24

| Metric | AAC Paper | Proxemics Paper | Average |
|--------|-----------|-----------------|---------|
| **Faithfulness** | 0.913 | 0.833 | **0.873** |
| **Answer Relevancy** | 0.853 | 0.947 | **0.900** |
| **Context Precision** | 0.955 | 0.988 | **0.972** |
| **Context Recall** | 0.867 | 0.967 | **0.917** |

✅ RAGAS Diagnosis: *"All metrics look good! Your RAG system is performing well."*

### 🧪 Run Evals Yourself

```bash
# Install Python dependencies
pip install ragas langchain-openai langchain-pinecone pinecone python-dotenv datasets

# Run evaluation pipeline
python evals/run_evals.py
```

Results are saved to `evals/results.json`.

The eval dataset (`evals/dataset.json`) contains 20 ground-truth question-answer pairs across both papers, covering factual questions, methodology questions, and finding-based questions.

---

## 🛠️ Tech Stack

| Category | Technology |
|----------|-----------|
| **Framework** | Next.js 15 (App Router) |
| **Language** | TypeScript |
| **AI Framework** | LangChain.js 0.3.x |
| **LLM** | OpenAI GPT-4 |
| **Embeddings** | OpenAI text-embedding-ada-002 (1536 dims) |
| **Vector Database** | Pinecone |
| **Styling** | Custom CSS (Dark Mode) |
| **Deployment** | Vercel (Serverless) |

---

## Getting Started

### Prerequisites

- Node.js 18+
- OpenAI API Key → [Get one here](https://platform.openai.com/api-keys)
- Pinecone API Key → [Get one here](https://app.pinecone.io)

---

### 1. Clone the Repository

```bash
git clone https://github.com/MerubS/PaperChat.git
cd PaperChat
```

### 2. Install Dependencies

```bash
npm install --legacy-peer-deps
```

### 3. Set Up Environment Variables

Create a `.env` file in the root directory:

```env
OPENAI_API_KEY=sk-your-openai-api-key-here
PINECONE_API_KEY=your-pinecone-api-key-here
PINECONE_INDEX_NAME=paperchat
```

### 4. Set Up Pinecone Index

1. Go to [app.pinecone.io](https://app.pinecone.io)
2. Click **Create Index**
3. Use these settings:

```
Name:        paperchat
Dimensions:  1536
Metric:      cosine
Vector Type: Dense
```

### 5. Run the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## 📁 Project Structure

```
PaperChat/
├── public/
│   └── screenshots/          # README screenshots
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── upload/
│   │   │   │   └── route.ts  # PDF upload & processing endpoint
│   │   │   └── query/
│   │   │       └── route.ts  # Question answering endpoint
│   │   ├── globals.css       # Global dark mode styles
│   │   ├── layout.tsx        # Root layout
│   │   └── page.tsx          # Main chat UI
│   ├── lib/
│   │   └── rag.ts            # Core RAG logic (LangChain + Pinecone)
│   └── test.ts               # Backend test script
├── .env                      # Environment variables (not committed)
├── .gitignore
├── next.config.js
├── package.json
└── tsconfig.json
```

---

## 🔌 API Endpoints

### `POST /api/upload`

Uploads and processes a PDF file into vector embeddings.

**Request:**
```
Content-Type: multipart/form-data
Body: { file: File (PDF, max 10MB) }
```

**Response:**
```json
{
  "success": true,
  "documentId": "550e8400-e29b-41d4-a716-446655440000",
  "chunks": 25,
  "pages": 10
}
```

---

### `POST /api/query`

Queries the document and returns an AI-generated answer.

**Request:**
```json
{
  "question": "What is this paper about?",
  "documentId": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Response:**
```json
{
  "success": true,
  "answer": "This paper examines...",
  "question": "What is this paper about?",
  "sources": [
    {
      "preview": "Relevant excerpt from the paper...",
      "page": 3
    }
  ]
}
```

---

## Configuration

Customize the RAG pipeline in `src/lib/rag.ts`:

```typescript
// Chunking settings
const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1000,    // Increase for more context per chunk
  chunkOverlap: 200,  // Overlap to prevent cutting ideas mid-sentence
});

// Retrieval settings
const retriever = vectorStore.asRetriever({
  k: 3,              // Number of relevant chunks to retrieve
});

// LLM settings
const model = new ChatOpenAI({
  modelName: "gpt-4",      // Switch to "gpt-3.5-turbo" to reduce cost
  temperature: 0,           // 0 = deterministic answers
});
```

---

## Deployment

### Deploy to Vercel

1. Push your code to GitHub
2. Import repo at [vercel.com](https://vercel.com)
3. Add environment variables:

```
OPENAI_API_KEY=sk-...
PINECONE_API_KEY=...
PINECONE_INDEX_NAME=paperchat
```

4. Click **Deploy** — done in under 2 minutes!

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/MerubS/PaperChat)

---

## Why RAG?

Traditional LLMs can only answer based on their training data. RAG solves this by:

| Without RAG | With RAG (PaperChat) |
|-------------|---------------------|
| ❌ Can't read your specific paper | ✅ Reads and understands your paper |
| ❌ May hallucinate facts | ✅ Answers grounded in document |
| ❌ No source citations | ✅ Shows which section the answer came from |
| ❌ Limited to training data | ✅ Works with any document |

---

## 🛣️ Roadmap

- [ ] Multi-document support (query across multiple papers)
- [ ] Chat history persistence
- [ ] Source highlighting (show exact paragraph in PDF)
- [ ] Export conversation as PDF
- [ ] Support for other file formats (DOCX, TXT)
- [ ] Streaming responses

---

## 🤝 Contributing

Contributions are welcome!

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/NewFeature`)
3. Commit your changes (`git commit -m 'Add NewFeature'`)
4. Push to the branch (`git push origin feature/NewFeature`)
5. Open a Pull Request

---

## 👤 Author

**Merub Shaikh**

[![LinkedIn](https://img.shields.io/badge/LinkedIn-0077B5?style=for-the-badge&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/merub-shaikh/)
[![GitHub](https://img.shields.io/badge/GitHub-100000?style=for-the-badge&logo=github&logoColor=white)](https://github.com/MerubS)
[![Email](https://img.shields.io/badge/Email-D14836?style=for-the-badge&logo=gmail&logoColor=white)](mailto:merubnshaikh@gmail.com)

---

## 🙏 Acknowledgments

- [LangChain](https://langchain.com) — AI orchestration framework
- [OpenAI](https://openai.com) — GPT-4 and embeddings API
- [Pinecone](https://pinecone.io) — Vector database
- [Next.js](https://nextjs.org) — React framework
- [Vercel](https://vercel.com) — Deployment platform

---

<div align="center">
  <p>If you found this project helpful, please consider giving it a ⭐</p>
  <p>Built with ❤️ by <a href="https://github.com/MerubS">Merub Shaikh</a></p>
</div>
