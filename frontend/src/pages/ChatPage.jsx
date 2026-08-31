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

  const handleCopy = (text) => {
    navigator.clipboard.writeText(text);
    addToast('Risposta copiata negli appunti', 'success');
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
    <div className="workspace-container" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 100px)' }}>
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
                  <div style={{ 
                    width: '36px', height: '36px', borderRadius: '8px', 
                    backgroundColor: 'var(--primary-color, #2563eb)', color: '#ffffff', 
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 'bold', fontSize: '1.1rem'
                  }}>
                    {user?.full_name?.[0]?.toUpperCase() || user?.username?.[0]?.toUpperCase() || '?'}
                  </div>
                ) : (
                  <div style={{ width: '36px', height: '36px', borderRadius: '8px', backgroundColor: '#fff', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                    <img src="/hiway-icon.png" alt="HiPlan AI" style={{ width: '24px', height: '24px', objectFit: 'contain' }} />
                  </div>
                )}
              </div>

              {/* Bolla Messaggio */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '0' }}>
                <div style={{
                  backgroundColor: msg.sender === 'user' ? 'var(--primary-color, #3b82f6)' : 'var(--bg-secondary, #1e293b)',
                  color: msg.sender === 'user' ? '#fff' : 'var(--text-primary, #f1f5f9)',
                  padding: '14px 20px',
                  borderRadius: '16px',
                  borderTopRightRadius: msg.sender === 'user' ? '4px' : '16px',
                  borderTopLeftRadius: msg.sender === 'user' ? '16px' : '4px',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
                  lineHeight: '1.6',
                  fontSize: '0.95rem',
                  overflowWrap: 'break-word'
                }}>
                  {msg.sender === 'ai' ? (
                    <div className="prose prose-sm dark:prose-invert" style={{ color: 'inherit', maxWidth: '100%' }}>
                      <ReactMarkdown 
                        remarkPlugins={[remarkGfm]}
                        components={{
                          table: ({node, ...props}) => <div style={{ overflowX: 'auto', marginBottom: '1rem' }}><table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.9rem' }} {...props} /></div>,
                          th: ({node, ...props}) => <th style={{ border: '1px solid var(--border-color)', padding: '8px 12px', backgroundColor: 'rgba(0,0,0,0.04)', textAlign: 'left', fontWeight: '600' }} {...props} />,
                          td: ({node, ...props}) => <td style={{ border: '1px solid var(--border-color)', padding: '8px 12px' }} {...props} />,
                          p: ({node, ...props}) => <p style={{ margin: '0 0 0.75rem 0' }} {...props} />,
                          ul: ({node, ...props}) => <ul style={{ margin: '0 0 0.75rem 0', paddingLeft: '1.5rem' }} {...props} />
                        }}
                      >
                        {msg.text}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    msg.text
                  )}
                </div>

                {/* Tasto Copia per le risposte dell'AI */}
                {msg.sender === 'ai' && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '-4px' }}>
                    <button
                      onClick={() => handleCopy(msg.text)}
                      className="btn-icon"
                      title="Copia risposta"
                      style={{
                        background: 'transparent',
                        border: '1px solid var(--border-color)',
                        color: 'var(--text-secondary)',
                        cursor: 'pointer',
                        padding: '6px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: '6px',
                        backgroundColor: 'var(--bg-primary)',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                      }}
                    >
                      <Copy size={14} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
          {isLoading && (
            <div style={{ alignSelf: 'flex-start', display: 'flex', gap: '12px' }}>
              <div style={{ width: '36px', height: '36px', borderRadius: '8px', backgroundColor: '#fff', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                <img src="/hiway-icon.png" alt="HiPlan AI" style={{ width: '24px', height: '24px', objectFit: 'contain' }} />
              </div>
              <div style={{ backgroundColor: 'var(--bg-secondary, #1e293b)', padding: '14px 20px', borderRadius: '16px', borderTopLeftRadius: '4px', color: 'var(--text-secondary, #94a3b8)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Bot size={18} className="animate-pulse" />
                Sto analizzando la richiesta...
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <form onSubmit={handleSendMessage} style={{ display: 'flex', gap: '12px', marginTop: 'auto', backgroundColor: 'var(--bg-secondary)', padding: '12px', borderRadius: '24px', border: '1px solid var(--border-color)', alignItems: 'flex-end' }}>
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
            placeholder="Scrivi un messaggio per l'assistente... (Ctrl+Invio per inviare)"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                handleSendMessage(e);
              }
            }}
            disabled={isLoading}
          />
          <button 
            type="submit" 
            disabled={isLoading || !inputValue.trim()}
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '50%',
              backgroundColor: inputValue.trim() ? 'var(--primary-color, #2563eb)' : 'var(--bg-tertiary, #cbd5e1)',
              color: '#ffffff',
              border: 'none',
              cursor: inputValue.trim() && !isLoading ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background-color 0.2s',
              flexShrink: 0,
              padding: 0,
              marginBottom: '2px'
            }}
            title="Invia messaggio (Ctrl+Invio)"
          >
            <Send size={18} style={{ marginLeft: '-2px', color: '#ffffff' }} />
          </button>
        </form>

      </div>
    </div>
  );
}
