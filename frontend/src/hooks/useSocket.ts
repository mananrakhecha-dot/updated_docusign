import { useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

let globalSocket: Socket | null = null;

function getSocket(): Socket {
  if (!globalSocket || !globalSocket.connected) {
    globalSocket = io('/', {
      withCredentials: true,
      transports: ['websocket', 'polling'],
    });
  }
  return globalSocket;
}

export function useSocket() {
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    socketRef.current = getSocket();
    return () => {
      // Don't disconnect global socket on unmount
    };
  }, []);

  const joinEnvelope = useCallback((envelopeId: string) => {
    socketRef.current?.emit('join:envelope', envelopeId);
  }, []);

  const joinDashboard = useCallback((userId: string) => {
    socketRef.current?.emit('join:dashboard', userId);
  }, []);

  const on = useCallback((event: string, handler: (...args: any[]) => void) => {
    socketRef.current?.on(event, handler);
    return () => { socketRef.current?.off(event, handler); };
  }, []);

  return { joinEnvelope, joinDashboard, on, socket: socketRef };
}
