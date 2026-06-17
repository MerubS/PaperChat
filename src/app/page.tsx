'use client';

import { useState, useRef, useEffect } from 'react';

// --- Icons ---
const UploadIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="17 8 12 3 7 8"/>
    <line x1="12" y1="3" x2="12" y2="15"/>
  </svg>
);

const SendIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="22" y1="2" x2="11" y2="13"/>
    <polygon points="22 2 15 22 11 13 2 9 22 2"/>
  </svg>
);

const PaperIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
  </svg>
);

const BotIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="11" width="18" height="10" rx="2"/>
    <circle cx="12" cy="5" r="2"/>
    <path d="M12 7v4"/>
  </svg>
);

const UserIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
    <circle cx="12" cy="7" r="4"/>
  </svg>
);

// --- Types ---
interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

const SUGGESTIONS = [
  "What is this paper about?",
  "What methodology was used?",
  "What are the main findings?",
  "What are the limitations of this study?",
];

// --- Main Component ---
export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [documentId, setDocumentId] = useState<string>('');
  const [uploaded, setUploaded] = useState<boolean>(false);
  const [uploading, setUploading] = useState<boolean>(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [dragOver, setDragOver] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Handle file selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f && f.type === 'application/pdf') {
      setFile(f);
      setError('');
    } else {
      setError('Please upload a PDF file');
    }
  };

  // Handle drag and drop
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f && f.type === 'application/pdf') {
      setFile(f);
      setError('');
    } else {
      setError('Please drop a PDF file');
    }
  };

  // Upload PDF to backend
  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setError('');

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (data.success) {
        setDocumentId(data.documentId);
        setUploaded(true);
        setMessages([{
          role: 'assistant',
          content: `I've successfully processed **${file.name}** (${data.pages} pages, ${data.chunks} chunks). I'm ready to answer your questions! What would you like to know?`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }]);
      } else {
        setError(data.error || 'Upload failed. Please try again.');
      }
    } catch (err) {
      setError('Upload failed. Please check your connection and try again.');
    } finally {
      setUploading(false);
    }
  };

  // Send question to backend
  const handleSend = async (text?: string) => {
    const question = text || input.trim();
    if (!question || loading) return;

    setInput('');
    setError('');

    const userMessage: Message = {
      role: 'user',
      content: question,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages(prev => [...prev, userMessage]);
    setLoading(true);

    try {
      const res = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, documentId }),
      });

      const data = await res.json();
      console.log(data);

      if (data.success) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: data.response || 'I could not find an answer to that question.',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }]);
      } else {
        setError(data.error || 'Query failed. Please try again.');
      }
    } catch (err) {
      setError('Failed to get answer. Please try again.');
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  // Reset everything
  const handleReset = () => {
    setFile(null);
    setDocumentId('');
    setUploaded(false);
    setMessages([]);
    setInput('');
    setError('');
  };

  return (
    <div className="app-container">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="logo">
          <div className="logo-icon">📄</div>
          <span className="logo-text">PaperChat</span>
        </div>

        <button className="new-chat-btn" onClick={handleReset}>
          <span>+</span> New Chat
        </button>

        {file && (
          <div className="current-paper">
            <p className="section-label">Current Paper</p>
            <div className="paper-card">
              <span className="paper-icon"><PaperIcon /></span>
              <div>
                <p className="paper-name">{file.name}</p>
                <p className="paper-status">
                  {uploaded ? '✓ Processed' : 'Not uploaded'}
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="sidebar-spacer" />

        <div className="sidebar-footer">
          <p>Powered by</p>
          <p className="footer-stack">LangChain · OpenAI · Pinecone</p>
        </div>
      </aside>

      {/* Main Content */}
      <main className="main">
        {!uploaded ? (
          /* Upload Screen */
          <div className="upload-screen">
            <div className="upload-header">
              <div className="upload-icon-wrap">📄</div>
              <h1>Welcome to PaperChat</h1>
              <p>Upload a research paper and start asking questions</p>
            </div>

            {/* Drop Zone */}
            <div
              className={`dropzone ${dragOver ? 'dragover' : ''} ${file ? 'has-file' : ''}`}
              onDrop={handleDrop}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                onChange={handleFileChange}
                style={{ display: 'none' }}
              />
              {file ? (
                <div className="file-selected">
                  <span className="file-check">✅</span>
                  <p className="file-name">{file.name}</p>
                  <p className="file-hint">Click to change file</p>
                </div>
              ) : (
                <div className="file-empty">
                  <div className="upload-icon"><UploadIcon /></div>
                  <p className="drop-title">Drop your PDF here</p>
                  <p className="drop-hint">or click to browse files</p>
                </div>
              )}
            </div>

            {/* Error */}
            {error && <p className="error-msg">{error}</p>}

            {/* Upload Button */}
            <button
              className={`upload-btn ${file && !uploading ? 'active' : 'disabled'}`}
              onClick={handleUpload}
              disabled={!file || uploading}
            >
              {uploading ? (
                <><span className="spinner" /> Processing...</>
              ) : (
                <><UploadIcon /> Upload & Process</>
              )}
            </button>

            {/* Features */}
            <div className="features">
              {['Semantic Search', 'GPT-4 Powered', 'Instant Answers'].map(f => (
                <span key={f} className="feature-tag">✦ {f}</span>
              ))}
            </div>
          </div>
        ) : (
          /* Chat Screen */
          <div className="chat-screen">
            {/* Chat Header */}
            <div className="chat-header">
              <div className="chat-header-left">
                <span className="online-dot" />
                <span className="chat-filename">{file?.name}</span>
              </div>
              <button className="reset-btn" onClick={handleReset}>
                🗑 New Chat
              </button>
            </div>

            {/* Messages */}
            <div className="messages">
              {messages.map((msg, i) => (
                <div key={i} className="message-row">
                  <div className={`avatar ${msg.role}`}>
                    {msg.role === 'assistant' ? <BotIcon /> : <UserIcon />}
                  </div>
                  <div className="message-content">
                    <div className="message-meta">
                      <span className={`message-author ${msg.role}`}>
                        {msg.role === 'assistant' ? 'PaperChat' : 'You'}
                      </span>
                      <span className="message-time">{msg.timestamp}</span>
                    </div>
                    <p className="message-text">{msg.content}</p>
                  </div>
                </div>
              ))}

              {/* Loading */}
              {loading && (
                <div className="message-row">
                  <div className="avatar assistant">
                    <BotIcon />
                  </div>
                  <div className="typing-indicator">
                    <span /><span /><span />
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Suggestions */}
            {messages.length <= 1 && (
              <div className="suggestions">
                {SUGGESTIONS.map(s => (
                  <button
                    key={s}
                    className="suggestion-btn"
                    onClick={() => handleSend(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {/* Error */}
            {error && <p className="error-msg center">{error}</p>}

            {/* Input */}
            <div className="input-area">
              <div className="input-box">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="Ask anything about the paper..."
                  rows={1}
                  className="input-textarea"
                />
                <button
                  className={`send-btn ${input.trim() && !loading ? 'active' : 'disabled'}`}
                  onClick={() => handleSend()}
                  disabled={!input.trim() || loading}
                >
                  <SendIcon />
                </button>
              </div>
              <p className="input-hint">
                Press Enter to send · Shift+Enter for new line
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}