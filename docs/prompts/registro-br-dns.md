# Prompt — Configurar DNS do gabrielgarbrecht.dev.br no registro.br

> Cole este texto em qualquer IA para ela te guiar visualmente pelo painel do registro.br.

---

Você vai me guiar, passo a passo e de forma visual, na configuração de DNS do
domínio `gabrielgarbrecht.dev.br` no painel do registro.br (https://registro.br).
Eu estou logado no painel e você vai me dizer exatamente onde clicar em cada tela
("clique em Domínios → nome do domínio → ..."), descrevendo os botões e menus
conforme aparecem. Não pule etapas: confirme comigo o que está na tela antes de
prosseguir.

**Objetivo:** criar registros DNS para um domínio que servirá um site de
portfólio e um sistema (painel + API). A VPS já roda Caddy (TLS automático via
Let's Encrypt, portas 80/443).

**Dados da VPS:**
- IPv4: `178.156.207.205`
- IPv6: `2a01:4ff:f0:6fbf::1`

**Registros a criar (já configurados em 2026-08-22, use como referência):**

| Host | Tipo | Valor |
|---|---|---|
| `@` (domínio raiz) | A | `178.156.207.205` |
| `@` (domínio raiz) | AAAA | `2a01:4ff:f0:6fbf::1` |
| `aurasync` | A | `178.156.207.205` |
| `aurasync` | AAAA | `2a01:4ff:f0:6fbf::1` |
| `aurasync-api` | A | `178.156.207.205` |
| `aurasync-api` | AAAA | `2a01:4ff:f0:6fbf::1` |

**Observações importantes que você deve considerar:**
1. O registro.br pode exigir que o domínio esteja com o serviço de DNS
   gerenciado por ele ("DNS do registro.br") para permitir criação de registros.
   Se estiver em DNS externo, me explique como verificar e mudar isso.
2. O host para o domínio raiz pode ser vazio, `@` ou o próprio domínio,
   dependendo do formulário do registro.br — me diga qual usar na tela real.
3. Domínios recém-criados no registro.br podem demorar (minutos a horas) para
   publicar os registros nos servidores autoritativos (a/b.auto.dns.br) — não
   confunda "aparece no painel" com "publicado no DNS".

**Depois que eu criar os registros:**
4. Me passe os comandos para verificar a propagação:
   `dig +short gabrielgarbrecht.dev.br`,
   `dig +short aurasync.gabrielgarbrecht.dev.br` e
   `dig +short aurasync-api.gabrielgarbrecht.dev.br` — e o que cada saída deve mostrar.
5. Me explique quanto tempo a propagação costuma levar e como saber que o Caddy
   já emitiu o certificado (ex: abrir https://aurasync.gabrielgarbrecht.dev.br e
   ver o cadeado, ou `curl -sI https://aurasync.gabrielgarbrecht.dev.br`).

Responda em português, de forma objetiva, começando pelo passo 1.
