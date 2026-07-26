import 'dotenv/config';
import Fastify, {type FastifyReply, type FastifyRequest} from "fastify";
import {jsonSchemaTransform, serializerCompiler, validatorCompiler} from "fastify-type-provider-zod";
import { websocketManager } from "./lib/websocket.js";
import { WebSocketServer } from 'ws';
import fastifyJwt from "@fastify/jwt";
import {userRoutes} from "./routers/user.router";
import { productRoutes } from './routers/product.router.js';
import {orderRoutes} from "./routers/order.router";
import {inventoryRoutes} from "./routers/inventory.router";
import { webhookRoutes } from './routers/webhook.router.js';
import { dashboardRoutes } from './routers/dashboard.router.js';
import {fastifySwagger} from "@fastify/swagger";
import {fastifySwaggerUi} from "@fastify/swagger-ui";
import {fastifyCors} from "@fastify/cors";
import {fastifyRawBody} from "fastify-raw-body";

declare module "fastify" {
  export interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

const app = Fastify({ logger: true });

app.register(fastifyCors, {
  origin: process.env.NODE_ENV === 'production'
    ? ['https://lamata.tec.br']
    : '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 204
});

app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);

app.register(fastifyRawBody, {
  field: 'rawBody',
  global: false,
  encoding: 'utf8',
  routes: ['/api/webhooks/nuvemshop']
});

app.register(fastifyJwt, {
  secret: process.env.JWT_SECRET as string,
});

app.decorate("authenticate", async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    await request.jwtVerify();
  } catch (err) {
    reply.status(401).send({ error: "Token ausente ou inválido!" });
  }
});

app.register(fastifySwagger, {
  openapi: {
    info: {
      title: 'AuraSync API',
      description: 'Documentação oficial do E-commerce Backend',
      version: '1.0.0',
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
  },
  transform: jsonSchemaTransform,
});

app.register(fastifySwaggerUi, {
  routePrefix: '/docs',
});

app.register(userRoutes, { prefix: "/api" });
app.register(productRoutes, { prefix: "/api/products" });
app.register(orderRoutes, { prefix: '/api/orders' });
app.register(inventoryRoutes, { prefix: '/api/inventory' });
app.register(webhookRoutes, { prefix: '/api/webhooks' });
app.register(dashboardRoutes, { prefix: '/api' });

const start = async () => {
  try {
    const port = Number(process.env.PORT) || 3333;
    await app.listen({ port, host: "0.0.0.0" });

    // Manually create and attach the WebSocket server
    const wss = new WebSocketServer({ server: app.server });

    wss.on('connection', (socket) => {
      websocketManager.add(socket);
    });

    console.log(`🚀 WebSocket server is running`);
    console.log(`📚 Swagger documentation available at http://localhost:${port}/docs`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();