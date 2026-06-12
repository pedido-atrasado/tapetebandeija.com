# Backend Pix Sunize

Este Worker cria e consulta pagamentos Pix sem expor a chave secreta no site.

## Publicar

1. Edite `wrangler.toml` e substitua `SEU-USUARIO.github.io` pelo dominio real do site.
2. Execute `npm install`.
3. Execute `npx wrangler login`.
4. Cadastre a chave secreta da Sunize:

   `npx wrangler secret put SUNIZE_API_KEY`

5. Execute `npm run deploy`.
6. Copie a URL exibida e coloque em `../payment-config.js`.

Se a Sunize exigir outro nome de header ou prefixo, ajuste `SUNIZE_AUTH_HEADER` e `SUNIZE_AUTH_PREFIX` em `wrangler.toml`.
