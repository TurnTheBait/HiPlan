import { useEffect, useState, useRef } from 'react';
import { useToast } from '../context/ToastContext';

export default function useWebSocket(url, onMessage) {
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef(null);
  const onMessageRef = useRef(onMessage);
  const toast = useToast();

  // Mantieni sempre il ref aggiornato all'ultima versione della callback
  // senza dover ricreare la connessione WebSocket ad ogni render
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    if (!url) return;

    const connect = () => {
      const ws = new WebSocket(url);

      ws.onopen = () => {
        setIsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (onMessageRef.current) {
            onMessageRef.current(data);
          }
        } catch (error) {
          console.error("Errore nel parsing del messaggio WebSocket", error);
        }
      };

      ws.onerror = (error) => {
        console.error("WebSocket error", error);
      };

      ws.onclose = () => {
        setIsConnected(false);
        // Ritenta la connessione dopo 3 secondi
        setTimeout(connect, 3000);
      };

      wsRef.current = ws;
    };

    connect();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [url]);

  return { isConnected };
}
