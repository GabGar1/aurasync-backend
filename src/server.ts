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
import { authRoutes } from './routers/auth.router.js';
import { costRoutes } from './routers/cost.router.js';
import { externalSaleRoutes } from './routers/external-sale.router.js';
import { customerRoutes } from './routers/customer.router.js';
import { productSubgroupRoutes } from './routers/product-subgroup.router.js';
import { creditFeeRoutes } from './routers/credit-fee.router.js';
import { costClosingRoutes } from './routers/cost-closing.router.js';
import {fastifySwagger} from "@fastify/swagger";
import {fastifySwaggerUi} from "@fastify/swagger-ui";
import {fastifyCors} from "@fastify/cors";
import fastifyCookie from "@fastify/cookie";
import {fastifyRawBody} from "fastify-raw-body";

declare module "fastify" {
  export interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

const app = Fastify({ logger: true });

const allowedOrigins = process.env.NODE_ENV === 'production'
  ? ['https://lamata.tec.br']
  : ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:8080'];

app.register(fastifyCors, {
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-TOKEN'],
  exposedHeaders: ['XSRF-TOKEN'],
  optionsSuccessStatus: 204,
});

app.register(fastifyCookie);

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
  cookie: { cookieName: 'aurasync_token', signed: false },
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
app.register(authRoutes, { prefix: '/api/auth' });
app.register(costRoutes, { prefix: '/api/cost-components' });
app.register(externalSaleRoutes, { prefix: '/api/external-sales' });
app.register(customerRoutes, { prefix: '/api/customers' });
app.register(productSubgroupRoutes, { prefix: '/api/product-subgroups' });
app.register(creditFeeRoutes, { prefix: '/api/credit-fee-tiers' });
app.register(costClosingRoutes, { prefix: '/api/cost-closing' });

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
    app.log.error(err as Error);
    process.exit(1);
  }
};

start();