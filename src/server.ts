import Fastify, {type FastifyReply, type FastifyRequest} from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import "dotenv/config";
import fastifyJwt from "@fastify/jwt";
import {userRoutes} from "./routers/user.router";
import { productRoutes } from './routers/product.router.js';
import {orderRoutes} from "./routers/order.router";
import {inventoryRoutes} from "./routers/inventory.router";

declare module "fastify" {
  export interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

const app = Fastify({ logger: true });

app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);

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

app.register(userRoutes, { prefix: "/api" });
app.register(productRoutes, { prefix: "/api/products" });
app.register(orderRoutes, { prefix: '/api/orders' });
app.register(inventoryRoutes, { prefix: '/api/inventory' });

const start = async () => {
  try {
    const port = Number(process.env.PORT) || 3333;
    await app.listen({ port, host: "0.0.0.0" });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();