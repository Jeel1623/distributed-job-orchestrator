import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import YAML from 'yamljs';
import swaggerUi from 'swagger-ui-express';
import dotenv from 'dotenv';

// Load env vars
dotenv.config();

import router from './routes';
import { startScheduler, stopScheduler } from './services/scheduler';
import { startReaper, stopReaper } from './services/reaper';

const app = express();
const server = http.createServer(app);

// Configure Socket.IO
export const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  }
});

// Middlewares
app.use(cors());
app.use(express.json());

// Log requests in dev
if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    console.log(`[HTTP] ${req.method} ${req.path}`);
    next();
  });
}

// Serve OpenAPI Docs
try {
  const openapiPath = path.resolve(__dirname, '../../docs/openapi.yaml');
  const swaggerDocument = YAML.load(openapiPath);
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
  console.log('[API Docs] OpenAPI document loaded. Serving interactive Swagger UI at /api/docs');
} catch (err: any) {
  console.error('[API Docs] Warning: Could not load docs/openapi.yaml:', err.message);
}

// Mount Routes
app.use('/api', router);

// Error Handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[HTTP Error]', err);
  res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: err.message || 'Something went wrong on the server'
    }
  });
});

// Socket.IO Events
io.on('connection', (socket) => {
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[Socket.IO] Client connected: ${socket.id}`);
  }

  socket.on('disconnect', () => {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[Socket.IO] Client disconnected: ${socket.id}`);
    }
  });
});

// Startup
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`[Server] API Server running on port ${PORT}`);
  
  // Start background processes (only in non-test env, so we don't interfere with test execution)
  if (process.env.NODE_ENV !== 'test') {
    startScheduler();
    startReaper();
  }
});

// Graceful Shutdown
const shutdown = () => {
  console.log('[Server] Shutting down services...');
  stopScheduler();
  stopReaper();
  server.close(() => {
    console.log('[Server] HTTP server closed.');
    process.exit(0);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export default server;
