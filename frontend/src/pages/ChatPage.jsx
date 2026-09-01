import React, { useState, useRef, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Copy, User, Send, MessageSquarePlus, Bot } from 'lucide-react';

export default function ChatPage() {
  const { user } = useAuth();
  const { addToast } = useToast();
  
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
  }, [messages]);

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

  const sendText = async (text) => {
    if (!text || !text.trim()) return;
    const userMessage = {
      id: Date.now(),
      sender: 'user',
      text: text.trim(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);

    try {
      const response = await api.post('/chat', { message: userMessage.text });
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

      <div className="workspace-content" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '0 20px 20px 20px', gap: '20px', backgroundColor: 'var(--bg-primary)' }}>
        
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
                maxWidth: '85%'
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
                    <div className="chat-markdown">
                      <ReactMarkdown 
                        remarkPlugins={[remarkGfm]}
                        components={{
                          table: ({node, ...props}) => <div style={{ overflowX: 'auto', margin: '0.6rem 0 1rem 0' }}><table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.88rem' }} {...props} /></div>,
                          th: ({node, ...props}) => <th style={{ border: '1px solid var(--border-subtle)', padding: '6px 10px', backgroundColor: 'rgba(0,0,0,0.04)', textAlign: 'left', fontWeight: '600' }} {...props} />,
                          td: ({node, ...props}) => <td style={{ border: '1px solid var(--border-subtle)', padding: '6px 10px' }} {...props} />,
                        }}
                      >
                        {msg.text}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    msg.text
                  )}

                  {/* Tasto Copia per le risposte dell'AI */}
                  {msg.sender === 'ai' && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '12px', borderTop: '1px solid var(--border-subtle)', paddingTop: '8px' }}>
                      <button
                        onClick={() => handleCopy(msg.text)}
                        className="chat-copy-btn"
                        title="Copia risposta"
                      >
                        <Copy size={15} />
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
