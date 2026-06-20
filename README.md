# Tapete Bandeja

Site statico com checkout Pix integrado via backend Netlify.

## Publicar no GitHub Pages

1. Faca push deste repositorio para o GitHub.
2. Ative GitHub Pages no branch `main` ou no fluxo de deploy que voce usa.
3. Deixe `payment-config.js` apontando para o backend publicado.

## Configurar o checkout

O front-end nao deve receber chaves sensiveis. Configure a credencial do gateway no backend como variavel de ambiente:

- `VEGA_API_KEY`
- ou `VEGA_CLIENT_SECRET`
- ou `CLIENT_SECRET`

Se o gateway exigir dominio aprovado, configure tambem:

- `VEGA_DOMAIN`
- ou `VEGA_CHECKOUT_DOMAIN`
- ou `PAYMENTS_DOMAIN`

## Endpoint do pagamento

O site chama:

- `POST /api/checkout/pix`
- `GET /api/pix/status`

Esses endpoints sao mapeados pelo `netlify.toml` para as functions em `netlify/functions/`.
