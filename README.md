# 🚀 Baileys Server v7.0.0

Servidor HTTP REST para WhatsApp usando Baileys v7.0.0.

## ⚠️ Mudanças do Baileys v7.0.0

Este servidor usa Baileys v7.0.0 que tem mudanças importantes:

- **ESM Only**: Requer módulos ES (não CommonJS)
- **LIDs**: Sistema de Local Identifiers (novo formato de identificação)
- **No Auto-ACKs**: Não envia ACKs automaticamente (evita banimento)
- **Meta Coexistence**: Suporte para coexistência com Meta API

Veja a [documentação de migração](https://baileys.wiki/docs/migration/to-v7.0.0/) para mais detalhes.

## 📦 Instalação

```bash
cd baileys-server
npm install
```

## ⚙️ Configuração

1. Copie `.env.example` para `.env`:
```bash
cp .env.example .env
```

2. Configure as variáveis:
```env
PORT=8080
API_KEY=your-secret-key-here  # Opcional, mas recomendado
AUTH_DIR=./auth_info
LOG_LEVEL=info
```

## 🚀 Executar

### Desenvolvimento
```bash
npm run dev
```

### Produção
```bash
npm run build
npm start
```

## 📡 API Endpoints

### GET /status
Verifica status da conexão

**Resposta:**
```json
{
  "connected": true,
  "status": "connected",
  "phoneNumber": "5511999999999",
  "hasQrCode": false
}
```

### POST /connect
Inicia conexão e retorna QR Code

**Resposta:**
```json
{
  "success": true,
  "message": "Connection started",
  "status": "qr",
  "qrCode": "data:image/png;base64,..."
}
```

### GET /qr-code
Obtém QR Code atual (se disponível)

**Resposta:**
```json
{
  "qrCode": "data:image/png;base64,..."
}
```

### POST /send-message
Envia mensagem

**Request:**
```json
{
  "phone": "5511999999999",
  "message": "Olá!",
  "mediaUrl": "https://..." // opcional
}
```

**Resposta:**
```json
{
  "success": true,
  "messageId": "3EB0123456789ABCDEF"
}
```

### POST /disconnect
Desconecta WhatsApp

**Resposta:**
```json
{
  "success": true,
  "message": "Disconnected"
}
```

### GET /health
Health check

**Resposta:**
```json
{
  "status": "ok"
}
```

## 🔒 Autenticação

Se `API_KEY` estiver configurado, todas as requisições devem incluir header:

```
apikey: your-secret-key-here
```

ou

```
x-api-key: your-secret-key-here
```

## 📚 Documentação

- [Baileys GitHub](https://github.com/WhiskeySockets/Baileys)
- [Baileys v7.0.0 Migration Guide](https://baileys.wiki/docs/migration/to-v7.0.0/)

## ⚠️ Notas Importantes

1. **LIDs**: Baileys v7.0.0 usa Local Identifiers. O formato de JID pode ser LID ou PN (Phone Number).
2. **No Auto-ACKs**: WhatsApp está banindo usuários que enviam ACKs automaticamente. Baileys v7.0.0 não envia mais.
3. **ESM Only**: Este projeto usa ESM (`"type": "module"`). Não use `require()`.
