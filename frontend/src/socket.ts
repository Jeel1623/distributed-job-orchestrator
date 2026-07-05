import { io } from 'socket.io-client';

let socketUrl = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000';
if (socketUrl && !socketUrl.startsWith('http://') && !socketUrl.startsWith('https://')) {
  socketUrl = `https://${socketUrl}`;
}
const SOCKET_URL = socketUrl;

export const socket = io(SOCKET_URL, {
  autoConnect: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000
});

export default socket;
