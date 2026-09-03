import React, { useState, useRef, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Copy, User, Send, MessageSquarePlus, Bot, Download, Printer, ExternalLink, Mail } from 'lucide-react';

export default function ChatPage() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const navigate = useNavigate();

  const getInitialMessages = () => {
    const cached = localStorage.getItem('hiplan-chat-messages');
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch (e) {
        console.error('Failed to parse cached messages', e);
      }
    }
    return [
      {
        id: 1,
        sender: 'ai',
        text: `Ciao ${user?.full_name || user?.username || ''}! Sono l'assistente virtuale di HiPlan. Puoi chiedermi qualsiasi cosa sui progetti, task, o altre informazioni nel sistema.`,
      }
    ];
  };

  const [messages, setMessages] = useState(getInitialMessages);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const location = useLocation();
  const initialPromptSent = useRef(false);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
    localStorage.setItem('hiplan-chat-messages', JSON.stringify(messages));
  }, [messages, isLoading]);

  const handleResetChat = () => {
    const initialMsg = [
      {
        id: Date.now(),
        sender: 'ai',
        text: `Ciao ${user?.full_name || user?.username || ''}! Sono l'assistente virtuale di HiPlan. Come posso aiutarti?`,
      }
    ];
    setMessages(initialMsg);
    localStorage.setItem('hiplan-chat-messages', JSON.stringify(initialMsg));
    addToast('Chat resettata', 'success');
  };

  const handleCopy = async (text) => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "absolute";
        textArea.style.left = "-999999px";
        document.body.prepend(textArea);
        textArea.select();
        document.execCommand('copy');
        textArea.remove();
      }
      addToast('Risposta copiata negli appunti', 'success');
    } catch (err) {
      console.error('Failed to copy text: ', err);
      addToast('Errore durante la copia', 'error');
    }
  };

  const handleExportCsv = (text) => {
    try {
      const lines = text.split('\n');
      const tableLines = lines.filter(l => l.trim().startsWith('|') && l.trim().endsWith('|'));
      if (tableLines.length < 2) {
        addToast('Nessuna tabella rilevata nel messaggio', 'info');
        return;
      }
      
      const rows = [];
      for (const line of tableLines) {
        if (line.includes('---')) continue;
        const cells = line
          .split('|')
          .slice(1, -1)
          .map(c => {
            let val = c.trim();
            val = val.replace(/\[\*\*(.*?)\*\*\]\(.*?\)/g, '$1');
            val = val.replace(/\[(.*?)\]\(.*?\)/g, '$1');
            val = val.replace(/\*\*(.*?)\*\*/g, '$1');
            val = val.replace(/"/g, '""');
            return `"${val}"`;
          });
        rows.push(cells.join(';'));
      }
      
      const csvContent = '\uFEFF' + rows.join('\r\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `hiplan-analisi-${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      addToast('Tabella esportata in CSV per Excel', 'success');
    } catch (err) {
      console.error(err);
      addToast('Errore durante l\'esportazione CSV', 'error');
    }
  };

  const handlePrintMessage = (msgId, text) => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      window.print();
      return;
    }
    const targetEl = document.getElementById(`chat-msg-content-${msgId}`);
    const htmlBody = targetEl ? targetEl.innerHTML : `<pre style="white-space: pre-wrap;">${text}</pre>`;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Report HiPlan AI - ${new Date().toLocaleDateString('it-IT')}</title>
          <style>
            body { font-family: system-ui, -apple-system, sans-serif; padding: 32px; color: #1e293b; line-height: 1.5; font-size: 13px; }
            h1, h2, h3 { color: #0f172a; margin-top: 18px; margin-bottom: 8px; }
            table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 12px; }
            th { background: #f1f5f9; padding: 8px 10px; border: 1px solid #cbd5e1; text-align: left; font-weight: 600; text-transform: uppercase; font-size: 11px; }
            td { padding: 8px 10px; border: 1px solid #e2e8f0; vertical-align: middle; }
            hr { border: 0; border-top: 1px solid #e2e8f0; margin: 16px 0; }
            button { display: none; }
            a { color: #0284c7; text-decoration: none; }
            @media print { body { padding: 0; } }
          </style>
        </head>
        <body>
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #0284c7; padding-bottom: 10px; margin-bottom: 20px;">
            <h2 style="margin: 0; color: #0284c7; font-size: 18px;">HiPlan - Report Analisi Assistente</h2>
            <span style="font-size: 12px; color: #64748b;">${new Date().toLocaleString('it-IT')}</span>
          </div>
          <div>${htmlBody}</div>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 250);
  };

  const sendText = async (text) => {
    if (!text || !text.trim()) return;
    const userMessage = {
      id: Date.now(),
      sender: 'user',
      text: text.trim(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);
    const recentHistory = messages
      .filter((m) => m.text && !m.text.startsWith('Ciao!'))
      .slice(-6)
      .map((m) => ({ sender: m.sender, text: m.text }));

    try {
      const response = await api.post('/chat', {
        message: userMessage.text,
        history: recentHistory,
      });
      const aiMessage = {
        id: Date.now() + 1,
        sender: 'ai',
        text: response.data.response,
      };
      setMessages((prev) => [...prev, aiMessage]);
    } catch (error) {
      console.error('Errore durante l\'invio del messaggio:', error);
      addToast('Errore durante la comunicazione con l\'assistente.', 'error');
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          sender: 'ai',
          text: 'Scusa, si è verificato un errore di rete o di configurazione.',
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (location.state?.initialPrompt && !initialPromptSent.current) {
      initialPromptSent.current = true;
      sendText(location.state.initialPrompt);
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  const handleSendMessage = async (e) => {
    if (e) e.preventDefault();
    if (!inputValue.trim()) return;
    const textToSend = inputValue;
    setInputValue('');
    await sendText(textToSend);
  };

  return (
    <>
      <style>{`
        .chat-page-container {
          display: flex;
          flex-direction: column;
          height: calc(100vh - 100px);
          position: relative;
        }
        .chat-message-row {
          animation: fadeSlideUp 0.3s ease-out forwards;
          opacity: 0;
          transform: translateY(10px);
        }
        @keyframes fadeSlideUp {
          to { opacity: 1; transform: translateY(0); }
        }
        .chat-bubble-ai {
          background: var(--bg-secondary);
          color: var(--text-primary);
          padding: 16px 20px;
          border-radius: 16px;
          border-top-left-radius: 4px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.05);
          border: 1px solid var(--border-subtle);
          line-height: 1.6;
          font-size: 0.95rem;
          display: flex;
          flex-direction: column;
        }
        .chat-bubble-user {
          background: linear-gradient(135deg, var(--accent-500), var(--accent-600));
          color: #fff;
          padding: 16px 20px;
          border-radius: 16px;
          border-top-right-radius: 4px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.1);
          line-height: 1.6;
          font-size: 0.95rem;
        }
        .chat-avatar {
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        .chat-copy-btn {
          background: transparent;
          border: none;
          color: var(--text-secondary);
          padding: 6px;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .chat-copy-btn:hover {
          color: var(--accent-600);
          background: rgba(0,0,0,0.05);
        }
        .dark .chat-copy-btn:hover {
          background: rgba(255,255,255,0.1);
        }
        .chat-input-wrapper {
          background: var(--bg-secondary);
          border: 1px solid var(--border-color);
          border-radius: 24px;
          padding: 12px;
          display: flex;
          gap: 12px;
          align-items: flex-end;
          box-shadow: 0 4px 20px rgba(0,0,0,0.05);
          transition: box-shadow 0.3s, border-color 0.3s;
          margin-top: auto;
        }
        .chat-input-wrapper:focus-within {
          border-color: var(--accent-500);
          box-shadow: 0 4px 20px var(--accent-glow);
        }
        .chat-markdown {
          color: inherit;
          max-width: 100%;
          font-size: 0.95rem;
          line-height: 1.6;
        }
        .chat-markdown p {
          margin: 0 0 0.6rem 0;
        }
        .chat-markdown p:last-child {
          margin-bottom: 0;
        }
        .chat-markdown h1, .chat-markdown h2, .chat-markdown h3, .chat-markdown h4 {
          margin: 0.8rem 0 0.4rem 0;
          font-weight: 600;
          color: var(--text-primary);
        }
        .chat-markdown h1:first-child, .chat-markdown h2:first-child, .chat-markdown h3:first-child, .chat-markdown h4:first-child {
          margin-top: 0;
        }
        .chat-markdown ul, .chat-markdown ol {
          margin: 0 0 0.6rem 0;
          padding-left: 1.3rem;
        }
        .chat-markdown li {
          margin-bottom: 0.35rem;
          line-height: 1.5;
        }
        .chat-markdown li:last-child {
          margin-bottom: 0;
        }
        .chat-markdown li > p {
          margin: 0 0 0.25rem 0;
        }
        .chat-markdown li > ul, .chat-markdown li > ol {
          margin-top: 0.25rem;
          margin-bottom: 0.35rem;
          padding-left: 1.2rem;
        }
        .chat-markdown strong {
          font-weight: 600;
          color: var(--text-primary);
        }
        .chat-markdown code {
          background: rgba(0,0,0,0.06);
          padding: 2px 5px;
          border-radius: 4px;
          font-size: 0.85em;
          font-family: monospace;
        }
        .dark .chat-markdown code {
          background: rgba(255,255,255,0.1);
        }
        .chat-markdown blockquote {
          border-left: 3px solid var(--accent-500);
          margin: 0.6rem 0;
          padding-left: 0.75rem;
          color: var(--text-secondary);
        }
        .chat-send-btn {
          width: 44px;
          height: 44px;
          border-radius: 50%;
          border: none;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
          flex-shrink: 0;
          margin-bottom: 2px;
        }
        .chat-send-btn.active {
          background: linear-gradient(135deg, var(--accent-500), var(--accent-600));
          color: #ffffff;
          cursor: pointer;
          box-shadow: 0 4px 12px var(--accent-glow);
        }
        .chat-send-btn.active:hover {
          transform: scale(1.05);
        }
        .chat-send-btn.disabled {
          background: var(--bg-tertiary);
          color: var(--text-muted);
          cursor: not-allowed;
        }
        .chat-quick-chips {
          display: flex;
          gap: 8px;
          overflow-x: auto;
          padding: 4px 2px 2px 2px;
          scrollbar-width: none;
        }
        .chat-quick-chips::-webkit-scrollbar {
          display: none;
        }
        .chat-chip-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          border-radius: 20px;
          font-size: 0.8125rem;
          font-weight: 500;
          white-space: nowrap;
          background: var(--bg-secondary);
          border: 1px solid var(--border-default);
          color: var(--text-secondary);
          cursor: pointer;
          transition: all 0.15s ease;
          user-select: none;
          box-shadow: var(--shadow-sm);
        }
        .chat-chip-btn:hover:not(:disabled) {
          background: var(--accent-50, rgba(99, 102, 241, 0.08));
          border-color: var(--accent-500, #6366f1);
          color: var(--accent-600, #4f46e5);
          transform: translateY(-1px);
        }
        .chat-chip-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        /* STILI TABELLE CHAT (Larghezza generosa, scroll orizzontale, zero spezzamenti sgradevoli) */
        .chat-table-wrapper {
          width: 100%;
          overflow-x: auto;
          margin: 12px 0 16px 0;
          border-radius: 8px;
          border: 1px solid var(--border-default, #e2e8f0);
          background: var(--bg-surface, #ffffff);
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
          -webkit-overflow-scrolling: touch;
        }
        .dark .chat-table-wrapper {
          background: var(--bg-secondary, #1e293b);
          border-color: var(--border-color, #334155);
        }
        .chat-table {
          width: 100%;
          min-width: 680px;
          border-collapse: collapse;
          font-size: 0.86rem;
          text-align: left;
        }
        .chat-th {
          background-color: var(--bg-secondary, #f8fafc);
          color: var(--text-secondary, #475569);
          font-weight: 600;
          font-size: 0.8rem;
          padding: 10px 14px;
          border-bottom: 2px solid var(--border-default, #e2e8f0);
          border-right: 1px solid var(--border-subtle, #f1f5f9);
          white-space: nowrap;
        }
        .dark .chat-th {
          background-color: rgba(255, 255, 255, 0.04);
          border-bottom-color: var(--border-color, #334155);
          border-right-color: var(--border-color, #334155);
          color: var(--text-muted, #94a3b8);
        }
        .chat-th:last-child {
          border-right: none;
        }
        .chat-td {
          padding: 10px 14px;
          border-bottom: 1px solid var(--border-subtle, #f1f5f9);
          border-right: 1px solid var(--border-subtle, #f1f5f9);
          color: var(--text-primary);
          vertical-align: middle;
          line-height: 1.45;
          word-break: normal;
          overflow-wrap: normal;
        }
        .dark .chat-td {
          border-bottom-color: var(--border-color, #334155);
          border-right-color: var(--border-color, #334155);
        }
        .chat-td:last-child {
          border-right: none;
        }
        .chat-table tr:last-child td {
          border-bottom: none;
        }
        .chat-table tr:hover td {
          background-color: var(--bg-hover, rgba(0, 0, 0, 0.02));
        }
        .dark .chat-table tr:hover td {
          background-color: rgba(255, 255, 255, 0.03);
        }

        /* BADGE LINK AZIONABILI ALL'INTERNO DELLA CHAT */
        .chat-action-badge-btn {
          display: inline-flex;
          align-items: center;
          gap: 3px;
          background: var(--accent-50, #eff6ff);
          color: var(--accent-700, #1d4ed8);
          border: 1px solid var(--accent-200, #bfdbfe);
          border-radius: 6px;
          padding: 2px 7px;
          font-size: 0.82rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s ease;
          vertical-align: middle;
          text-decoration: none;
        }
        .chat-action-badge-btn:hover {
          background: var(--accent-100, #dbeafe);
          border-color: var(--accent-400, #60a5fa);
          transform: translateY(-1px);
        }
        .dark .chat-action-badge-btn {
          background: rgba(59, 130, 246, 0.15);
          color: #93c5fd;
          border-color: rgba(59, 130, 246, 0.3);
        }
        .dark .chat-action-badge-btn:hover {
          background: rgba(59, 130, 246, 0.25);
          border-color: rgba(59, 130, 246, 0.5);
        }

        .chat-action-email-btn {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          background: #10b981;
          color: #ffffff !important;
          border-radius: 6px;
          padding: 5px 12px;
          font-size: 0.82rem;
          font-weight: 600;
          text-decoration: none;
          margin: 6px 0;
          box-shadow: 0 1px 3px rgba(0,0,0,0.12);
          transition: all 0.15s ease;
        }
        .chat-action-email-btn:hover {
          background: #059669;
          transform: translateY(-1px);
        }

        .chat-bubble-actions {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 6px;
          margin-top: 10px;
          border-top: 1px solid var(--border-subtle, #f1f5f9);
          padding-top: 8px;
          flex-wrap: wrap;
        }
        .dark .chat-bubble-actions {
          border-top-color: rgba(255, 255, 255, 0.08);
        }
        .chat-action-tool-btn {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          background: transparent;
          color: var(--text-secondary, #64748b);
          border: 1px solid var(--border-default, #e2e8f0);
          border-radius: 6px;
          padding: 4px 8px;
          font-size: 0.76rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .chat-action-tool-btn:hover {
          background: var(--bg-hover, #f8fafc);
          color: var(--text-primary);
          border-color: var(--border-color);
        }
        .dark .chat-action-tool-btn {
          border-color: rgba(255, 255, 255, 0.12);
          color: #94a3b8;
        }
        .dark .chat-action-tool-btn:hover {
          background: rgba(255, 255, 255, 0.06);
          color: #f8fafc;
        }
      `}</style>
      <div className="workspace-container chat-page-container">
        <header className="workspace-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid var(--border-color)' }}>
          <h2 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--text-primary)' }}>Chat</h2>
          <div className="header-actions">
            <button
              onClick={handleResetChat}
              className="btn btn-primary"
              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', borderRadius: '8px' }}
            >
              <MessageSquarePlus size={18} />
              Nuova Chat
            </button>
          </div>
        </header>

        <div className="workspace-content" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '0 20px 20px 20px', gap: '14px', backgroundColor: 'var(--bg-primary)' }}>

          <div className="chat-messages" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '24px', paddingRight: '10px' }}>
            {messages.map((msg) => (
              <div
                key={msg.id}
                className="chat-message-row"
                style={{
                  alignSelf: msg.sender === 'user' ? 'flex-end' : 'flex-start',
                  display: 'flex',
                  flexDirection: msg.sender === 'user' ? 'row-reverse' : 'row',
                  gap: '12px',
                  maxWidth: msg.sender === 'user' ? '80%' : '94%'
                }}
              >
                {/* Icona Mittente */}
                <div style={{ flexShrink: 0, marginTop: '4px' }}>
                  {msg.sender === 'user' ? (
                    <div className="chat-avatar" style={{
                      width: '36px', height: '36px', borderRadius: '8px',
                      background: 'linear-gradient(135deg, var(--accent-500), var(--accent-600))', color: '#ffffff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 'bold', fontSize: '1.1rem'
                    }}>
                      {user?.full_name?.[0]?.toUpperCase() || user?.username?.[0]?.toUpperCase() || '?'}
                    </div>
                  ) : (
                    <div className="chat-avatar" style={{ width: '36px', height: '36px', borderRadius: '8px', backgroundColor: '#fff', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                      <img src="/hiway-icon.png" alt="HiPlan AI" style={{ width: '24px', height: '24px', objectFit: 'contain' }} />
                    </div>
                  )}
                </div>

                {/* Bolla Messaggio */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '0' }}>
                  <div className={msg.sender === 'user' ? 'chat-bubble-user' : 'chat-bubble-ai'}>
                    {msg.sender === 'ai' ? (
                      <div className="chat-markdown" id={`chat-msg-content-${msg.id}`}>
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            table: ({ node, ...props }) => (
                              <div className="chat-table-wrapper">
                                <table className="chat-table" {...props} />
                              </div>
                            ),
                            th: ({ node, ...props }) => <th className="chat-th" {...props} />,
                            td: ({ node, ...props }) => <td className="chat-td" {...props} />,
                            a: ({ node, href, children, ...props }) => {
                              if (href && href.startsWith('/projects/')) {
                                return (
                                  <button
                                    onClick={(e) => {
                                      e.preventDefault();
                                      navigate(href);
                                    }}
                                    className="chat-action-badge-btn"
                                    title="Apri commessa nel diagramma di Gantt"
                                  >
                                    <ExternalLink size={12} style={{ marginRight: '3px' }} />
                                    {children}
                                  </button>
                                );
                              }
                              if (href && href.startsWith('mailto:')) {
                                return (
                                  <a
                                    href={href}
                                    className="chat-action-email-btn"
                                    title="Apri nel tuo client di posta"
                                  >
                                    <Mail size={13} />
                                    {children}
                                  </a>
                                );
                              }
                              return (
                                <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
                                  {children}
                                </a>
                              );
                            }
                          }}
                        >
                          {msg.text}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      msg.text
                    )}

                    {/* Azioni rapide sotto le risposte dell'AI: Esporta CSV, Stampa PDF, Copia */}
                    {msg.sender === 'ai' && (
                      <div className="chat-bubble-actions">
                        {msg.text && msg.text.includes('|') && (
                          <button
                            onClick={() => handleExportCsv(msg.text)}
                            className="chat-action-tool-btn"
                            title="Esporta la tabella in file CSV (compatibile con Microsoft Excel)"
                          >
                            <Download size={13} />
                            <span>Esporta CSV</span>
                          </button>
                        )}
                        <button
                          onClick={() => handlePrintMessage(msg.id, msg.text)}
                          className="chat-action-tool-btn"
                          title="Stampa o salva in PDF questa analisi"
                        >
                          <Printer size={13} />
                          <span>Stampa / PDF</span>
                        </button>
                        <button
                          onClick={() => handleCopy(msg.text)}
                          className="chat-action-tool-btn"
                          title="Copia negli appunti"
                        >
                          <Copy size={13} />
                          <span>Copia</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="chat-message-row" style={{ alignSelf: 'flex-start', display: 'flex', gap: '12px' }}>
                <div className="chat-avatar" style={{ width: '36px', height: '36px', borderRadius: '8px', backgroundColor: '#fff', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0, marginTop: '4px' }}>
                  <img src="/hiway-icon.png" alt="HiPlan AI" style={{ width: '24px', height: '24px', objectFit: 'contain' }} />
                </div>
                <div className="chat-bubble-ai" style={{ color: 'var(--text-secondary, #94a3b8)', display: 'flex', alignItems: 'center', gap: '8px', flexDirection: 'row' }}>
                  <Bot size={18} className="animate-pulse" />
                  <span>Sto analizzando la richiesta...</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* QUICK ACTION CHIPS (Domande Rapide) */}
          <div className="chat-quick-chips">
            {[
              { icon: '☀️', label: 'Briefing di oggi', text: 'Dammi il mio briefing operativo del giorno con priorità e scadenze' },
              { icon: '🎯', label: 'Le mie attività', text: 'Quali sono le mie attività e fasi in corso?' },
              { icon: '📊', label: 'Stato commesse', text: 'Mostrami una panoramica dello stato delle commesse attive' },
              { icon: '⏱️', label: 'Budget & Ore', text: 'Analizza il consumo ore e gli scostamenti di budget delle commesse' },
              { icon: '👥', label: 'Carico addetti', text: 'Chi ha il maggior carico di lavoro tra gli addetti?' },
              { icon: '📅', label: 'Scadenze 30gg', text: 'Quali fasi o commesse scadono questo mese?' },
              { icon: '⚠️', label: 'Verifica ritardi', text: 'Ci sono attività in ritardo o problemi di calendario?' },
            ].map((chip, idx) => (
              <button
                key={idx}
                type="button"
                className="chat-chip-btn"
                disabled={isLoading}
                onClick={() => sendText(chip.text)}
                title={chip.text}
              >
                <span>{chip.icon}</span>
                <span>{chip.label}</span>
              </button>
            ))}
          </div>

          <form onSubmit={handleSendMessage} className="chat-input-wrapper">
            <textarea
              style={{
                flex: 1,
                padding: '12px 16px',
                borderRadius: '16px',
                border: 'none',
                backgroundColor: 'transparent',
                color: 'var(--text-primary)',
                outline: 'none',
                fontSize: '1rem',
                resize: 'none',
                minHeight: '48px',
                maxHeight: '150px',
                fontFamily: 'inherit'
              }}
              rows={inputValue.split('\n').length > 4 ? 4 : inputValue.split('\n').length || 1}
              placeholder="Scrivi un messaggio per l'assistente... (Invio per inviare, Shift+Invio per a capo)"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage(e);
                }
              }}
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={isLoading || !inputValue.trim()}
              className={`chat-send-btn ${inputValue.trim() && !isLoading ? 'active' : 'disabled'}`}
              title="Invia messaggio (Invio)"
            >
              <Send size={18} style={{ marginLeft: '-2px', color: 'inherit' }} />
            </button>
          </form>

        </div>
      </div>
    </>
  );
}
