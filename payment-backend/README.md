# Backend Pix Beehive

Este Worker cria e consulta pagamentos Pix sem expor a chave secreta no site.

## Publicar

1. Edite `wrangler.toml` e substitua `SEU-USUARIO.github.io` pelo dominio real do site.
2. Execute `npm install`.
3. Execute `npx wrangler login`.
4. Cadastre uma nova chave secreta da Beehive:

   `npx wrangler secret put BEEHIVE_SECRET_KEY`

5. Execute `npm run deploy`.
6. Copie a URL exibida e coloque em `../payment-config.js`.

O Client Secret enviado anteriormente deve ser revogado antes da publicacao.
