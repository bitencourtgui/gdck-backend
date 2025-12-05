# 🚀 Deploy no Koyeb - 100% Gratuito (Sem Cartão)

Guia completo para fazer deploy do Baileys Server no Koyeb **sem precisar de cartão de crédito**.

## ✅ Por que Koyeb?

- ✅ **100% Gratuito** permanente
- ✅ **Sem cartão** de crédito necessário
- ✅ **Sempre ativo** (sem sleep)
- ✅ **Deploy via GitHub** (automático)
- ✅ **2 instâncias** grátis
- ✅ **SSL/HTTPS** automático

---

## 📋 Pré-requisitos

1. Conta no GitHub (você já tem)
2. Repositório `gdck-backend` no GitHub (já está pronto)

---

## 🎯 Passo a Passo

### 1️⃣ **Criar Conta no Koyeb**

1. Acesse: https://app.koyeb.com/auth/signup
2. **Faça login com GitHub** (recomendado)
3. Confirme seu email
4. ✅ Pronto! Sem cartão necessário!

---

### 2️⃣ **Conectar Repositório GitHub**

1. No dashboard do Koyeb, clique em **"Create App"**
2. Selecione **"GitHub"** como source
3. Conecte sua conta GitHub
4. Selecione o repositório: **`bitencourtgui/gdck-backend`**
5. Clique em **"Next"**

---

### 3️⃣ **Configurar Build**

Na tela de configuração:

**Builder:** `Dockerfile`

**Dockerfile:** (deixe o padrão ou especifique `Dockerfile`)

**Build command:** (deixe vazio, o Dockerfile já tem tudo)

**Port:** `8080`

---

### 4️⃣ **Configurar Variáveis de Ambiente**

Adicione as seguintes variáveis de ambiente:

| Nome | Valor | Obrigatório |
|------|-------|-------------|
| `PORT` | `8080` | ✅ Sim |
| `NODE_ENV` | `production` | ✅ Sim |
| `API_KEY` | `sua-chave-secreta-forte` | ⚠️ Recomendado |
| `CRM_WEBHOOK_URL` | `https://gdck-frontend-crm.vercel.app/api/whatsapp/save-message` | ✅ Sim |
| `AUTH_DIR` | `/app/auth_info` | ✅ Sim |
| `LOG_LEVEL` | `info` | ❌ Opcional |

**Importante:**
- `API_KEY`: Crie uma senha forte (ex: `gdck-2024-secret-key-super-forte`)
- `CRM_WEBHOOK_URL`: Use a URL do seu frontend na Vercel

---

### 5️⃣ **Configurar Instância**

**Region:** `Frankfurt (fra)` ou o mais próximo

**Instance type:** `Nano` (gratuito)
- 512 MB RAM
- 0.1 vCPU
- Sempre ativo ✅

---

### 6️⃣ **Deploy**

1. Clique em **"Deploy"**
2. Aguarde o build (~2-3 minutos)
3. ✅ Aplicação vai estar no ar!

---

## 🌐 **URL da Aplicação**

Após o deploy, você receberá uma URL tipo:

```
https://gdck-baileys-server-seu-usuario.koyeb.app
```

**Copie essa URL!** Você vai precisar dela.

---

## 🔗 **Configurar no Frontend (Vercel)**

1. Vá no Dashboard da Vercel
2. Selecione seu projeto `gdck-frontend-crm`
3. Settings → Environment Variables
4. Adicione:

```
BAILEYS_SERVER_URL=https://gdck-baileys-server-seu-usuario.koyeb.app
```

5. Faça **Redeploy** do frontend

---

## 🧪 **Testar a API**

```bash
# Health check
curl https://gdck-baileys-server-seu-usuario.koyeb.app/health

# Status (com sua API_KEY)
curl -H "apikey: sua-chave-secreta" \
  https://gdck-baileys-server-seu-usuario.koyeb.app/status

# Iniciar conexão
curl -X POST \
  -H "apikey: sua-chave-secreta" \
  -H "Content-Type: application/json" \
  https://gdck-baileys-server-seu-usuario.koyeb.app/connect
```

---

## ⚠️ **LIMITAÇÃO IMPORTANTE**

### Sessões WhatsApp

Como o Koyeb gratuito **não tem volume persistente**, a sessão do WhatsApp será perdida quando:
- Fizer redeploy
- Aplicação reiniciar
- Houver atualização

**Solução:**
- Você terá que escanear o QR Code novamente após redeploys
- Para evitar isso, considere:
  1. Fazer deploys menos frequentes
  2. Ou adicionar integração com storage externo (Supabase, AWS S3)

---

## 📊 **Recursos Gratuitos (Koyeb)**

✅ **O que você tem de graça:**
- 2 serviços web
- 512 MB RAM por serviço
- 2 GB de transferência/mês
- SSL/HTTPS automático
- Logs em tempo real
- Deploys ilimitados

---

## 🔄 **Auto-Deploy**

Após a configuração inicial, **todo push para `main`** vai automaticamente:
1. ✅ Fazer rebuild da aplicação
2. ✅ Deploy automático
3. ✅ Health check
4. ✅ Aplicação atualizada

---

## 📋 **Comandos Úteis**

### Ver Logs
No dashboard do Koyeb:
- Vá em **"Logs"** no menu lateral
- Logs em tempo real

### Reiniciar Aplicação
No dashboard:
- Vá em **"Settings"**
- Clique em **"Restart"**

### Forçar Redeploy
No dashboard:
- Vá em **"Deployments"**
- Clique em **"Redeploy"**

---

## 🐛 **Troubleshooting**

### Build Failed
- Verifique os logs de build
- Confirme que o Dockerfile está correto
- Verifique se todas as dependências estão no package.json

### Health Check Failed
- Verifique se a porta `8080` está configurada
- Confirme que o endpoint `/health` existe
- Veja os logs da aplicação

### Conexão WhatsApp não funciona
- Verifique se `CRM_WEBHOOK_URL` está correto
- Confirme que o frontend está recebendo webhooks
- Veja os logs para erros

### Sessão perdida após redeploy
- **Normal!** Koyeb gratuito não tem volume persistente
- Você precisa escanear o QR Code novamente
- Considere fazer menos deploys

---

## 💰 **Custos**

✅ **100% GRATUITO** permanente!

- Sem cartão necessário
- Sem surpresas
- Sem cobranças ocultas

---

## 📚 **Documentação Oficial**

- Koyeb Docs: https://www.koyeb.com/docs
- Koyeb Pricing: https://www.koyeb.com/pricing
- Support: https://www.koyeb.com/support

---

## ✅ **Checklist Final**

Antes de considerar completo:

- [ ] Conta criada no Koyeb
- [ ] Repositório conectado
- [ ] Build configurado (Dockerfile)
- [ ] Variáveis de ambiente configuradas
- [ ] Deploy realizado com sucesso
- [ ] Health check passando
- [ ] URL pública funcionando
- [ ] Frontend atualizado com BAILEYS_SERVER_URL
- [ ] Teste de conexão WhatsApp funcionando

---

## 🎉 **Pronto!**

Seu servidor Baileys está rodando no Koyeb **100% grátis e sem cartão!** 🚀

**Próximos passos:**
1. Acesse seu frontend
2. Vá em configurações de WhatsApp
3. Clique em "Conectar"
4. Escaneie o QR Code
5. Comece a usar!

---

**Observação:** Guarde bem sua sessão! Evite redeploys desnecessários para não perder a conexão WhatsApp.

