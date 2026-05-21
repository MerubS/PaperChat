'use client';

import { useState } from 'react';

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [documentId, setDocumentId] = useState<string>('');
  const [question, setQuestion] = useState<string>('');
  const [answer, setAnswer] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [uploaded, setUploaded] = useState<boolean>(false);

  // Upload PDF
  const handleUpload = async () => {
    if (!file) return;

    setLoading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      
      if (data.success) {
        setDocumentId(data.documentId);
        setUploaded(true);
        alert(`✅ PDF uploaded! ${data.chunks} chunks created.`);
      } else {
        alert('❌ Upload failed: ' + data.error);
      }
    } catch (error) {
      alert('❌ Upload failed: ' + error);
    } finally {
      setLoading(false);
    }
  };

  // Ask question
  const handleAsk = async () => {
    if (!question || !documentId) return;

    setLoading(true);
    setAnswer('');

    try {
      const res = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, documentId }),
      });

      const data = await res.json();
      
      if (data.success) {
        setAnswer(data.answer);
      } else {
        alert('❌ Query failed: ' + data.error);
      }
    } catch (error) {
      alert('❌ Query failed: ' + error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl md:text-5xl font-bold text-gray-800 mb-2">
            📄 PaperChat
          </h1>
          <p className="text-gray-600 text-lg">
            AI-Powered Research Assistant
          </p>
        </div>

        {/* Upload Section */}
        {!uploaded && (
          <div className="bg-white rounded-xl shadow-lg p-6 md:p-8 mb-6">
            <h2 className="text-2xl font-semibold mb-4 text-gray-800">
              Upload Research Paper
            </h2>
            <p className="text-gray-600 mb-4">
              Upload a PDF research paper and ask questions about it.
            </p>
            
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 mb-4 text-center hover:border-blue-400 transition">
              <input
                type="file"
                accept=".pdf"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="hidden"
                id="file-upload"
              />
              <label
                htmlFor="file-upload"
                className="cursor-pointer"
              >
                {file ? (
                  <div>
                    <p className="text-green-600 font-medium">
                      ✓ {file.name}
                    </p>
                    <p className="text-sm text-gray-500 mt-1">
                      Click to change file
                    </p>
                  </div>
                ) : (
                  <div>
                    <p className="text-gray-600 font-medium">
                      Click to upload PDF
                    </p>
                    <p className="text-sm text-gray-500 mt-1">
                      or drag and drop
                    </p>
                  </div>
                )}
              </label>
            </div>

            <button
              onClick={handleUpload}
              disabled={!file || loading}
              className="w-full bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed font-medium transition"
            >
              {loading ? '⏳ Uploading...' : '📤 Upload PDF'}
            </button>
          </div>
        )}

        {/* Chat Section */}
        {uploaded && (
          <div className="bg-white rounded-xl shadow-lg p-6 md:p-8">
            <h2 className="text-2xl font-semibold mb-4 text-gray-800">
              💬 Ask Questions
            </h2>
            
            <div className="mb-4">
              <input
                type="text"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="What is this paper about?"
                className="w-full border-2 border-gray-300 rounded-lg px-4 py-3 focus:outline-none focus:border-blue-500 transition"
                onKeyPress={(e) => {
                  if (e.key === 'Enter' && !loading) {
                    handleAsk();
                  }
                }}
              />
            </div>

            <button
              onClick={handleAsk}
              disabled={!question || loading}
              className="w-full bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed font-medium mb-4 transition"
            >
              {loading ? '🤔 Thinking...' : '🚀 Ask'}
            </button>

            {/* Answer Display */}
            {answer && (
              <div className="mt-6 p-5 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-200">
                <p className="text-sm font-semibold text-blue-800 mb-2">
                  💡 Answer:
                </p>
                <p className="text-gray-800 whitespace-pre-wrap leading-relaxed">
                  {answer}
                </p>
              </div>
            )}

            {/* Reset Button */}
            <button
              onClick={() => {
                setUploaded(false);
                setDocumentId('');
                setQuestion('');
                setAnswer('');
                setFile(null);
              }}
              className="mt-6 text-sm text-blue-600 hover:text-blue-800 underline"
            >
              ← Upload different paper
            </button>
          </div>
        )}

        {/* Footer */}
        <div className="text-center mt-8 text-gray-600 text-sm">
          <p>Built with LangChain, Pinecone & OpenAI</p>
        </div>
      </div>
    </div>
  );
}