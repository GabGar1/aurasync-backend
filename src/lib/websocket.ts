import type { WebSocket } from 'ws';

// A simple in-memory store for active WebSocket connections
const connections = new Set<WebSocket>();

export const websocketManager = {
  /**
   * Adds a new WebSocket connection to the manager.
   * Also sets up listeners to automatically remove the connection when it's closed or has an error.
   */
  add(socket: WebSocket) {
    connections.add(socket);
    console.log('New WebSocket connection established.');

    socket.on('close', () => {
      connections.delete(socket);
      console.log('WebSocket connection closed.');
    });

    socket.on('error', (error) => {
      console.error('WebSocket error:', error);
      connections.delete(socket); // Remove on error as well
    });
  },

  /**
   * Sends a message to all currently active WebSocket connections.
   * @param message The message to broadcast. Can be a string or a JSON object.
   */
  broadcast(message: string | object) {
    if (connections.size === 0) {
      return; // No need to do anything if no one is connected
    }

    const messageString = typeof message === 'object' ? JSON.stringify(message) : message;

    console.log(`Broadcasting message to ${connections.size} client(s).`);
    for (const connection of connections) {
      // Ensure the connection is still open before trying to send
      if (connection.readyState === 1) { // WebSocket.OPEN
        connection.send(messageString);
      }
    }
  }
};