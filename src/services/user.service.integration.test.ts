import { describe, it, after } from "node:test";
import assert from "node:assert";
import { userService } from "./user.service.js";
import { db } from "../lib/db.js";

describe("UserService", () => {
  const testEmail = "testador_master@aurasync.com";

  // O 'after' roda quando todos os testes desse bloco terminarem.
  // Como um bom sênior, nós limpamos a sujeira que fizemos no banco!
  after(async () => {
    await db("users").where({ email: testEmail }).del();
    await db.destroy(); // Fecha a conexão do banco para o teste não ficar travado no terminal
  });

  it("deve criar um novo usuário com sucesso e ocultar a senha", async () => {
    const userData = {
      first_name: "Testador",
      last_name: "Master",
      email: testEmail,
      password: "senha_segura_123",
      username: "testador_master",
    };

    const user = await userService.createUser(userData);

    // As afirmações (Asserts) - É aqui que a mágica acontece
    assert.ok(user.id, "O usuário deve ter recebido um UUID do banco de dados");
    assert.strictEqual(user.first_name, "Testador");
    assert.strictEqual(user.email, testEmail);

    // Garantindo que a nossa regra de segurança de não devolver a senha funcionou
    assert.strictEqual(
      (user as any).password_hash,
      undefined,
      "A senha NÃO deve ser retornada no objeto de resposta"
    );
  });

  it("não deve permitir a criação de um usuário com e-mail duplicado", async () => {
    const userData = {
      first_name: "Clone",
      last_name: "Das Sombras",
      email: testEmail, // Tentando usar o mesmo e-mail do teste anterior!
      password: "senha_segura_123",
      username: "testador_master"
    };

    // assert.rejects verifica se a função "estourou" o erro que nós programamos
    await assert.rejects(
      async () => await userService.createUser(userData),
      (err: Error) => {
        assert.strictEqual(err.message, "Email already registered");
        return true;
      }
    );
  });
});