# 🚀 Koyeb Quick Start - 5 Minutos

**Deploy 100% gratuito, sem cartão de crédito!**

---

## ⚡ Deploy em 4 Passos

### 1️⃣ **Criar Conta** (1 minuto)
👉 https://app.koyeb.com/auth/signup

- Faça login com GitHub
- Confirme email
- ✅ Sem cartão necessário!

---

### 2️⃣ **Criar App** (1 minuto)

No dashboard:
1. Clique em **"Create App"**
2. Selecione **"GitHub"**
3. Conecte GitHub e autorize
4. Selecione repositório: **`bitencourtgui/gdck-backend`**

---

### 3️⃣ **Configurar** (2 minutos)

**Builder:** Dockerfile

**Port:** `8080`

**Environment Variables:**
```
PORT=8080
NODE_ENV=production
API_KEY=gdck-secret-2024-super-forte
CRM_WEBHOOK_URL=https://gdck-frontend-crm.vercel.app/api/whatsapp/save-message
AUTH_DIR=/app/auth_info
LOG_LEVEL=info
```

**Instance:** Nano (gratuito)

**Region:** Frankfurt ou mais próximo

---

### 4️⃣ **Deploy** (1 minuto)

1. Clique em **"Deploy"**
2. Aguarde build (~2-3 minutos)
3. ✅ Copie a URL gerada!

---

## 🔗 **Configurar no Frontend**

Vercel Dashboard → Environment Variables:

```
BAILEYS_SERVER_URL=https://sua-app.koyeb.app
```

Faça redeploy do frontend.

---

## ✅ **Testar**

```bash
curl https://sua-app.koyeb.app/health
```

Se retornar `{"status":"ok"}`, está funcionando! 🎉

---

## ⚠️ **Atenção**

**Sessão WhatsApp:**
- ❌ Perde em redeploys (Koyeb gratuito não tem volume)
- ✅ Solução: Escanear QR Code novamente
- 💡 Evite redeploys desnecessários

---

## 📚 **Precisa de mais detalhes?**

Veja: [KOYEB_DEPLOY.md](./KOYEB_DEPLOY.md)

---

## 💰 **Custo**

✅ **$0/mês** - 100% Gratuito!

---

**Pronto! Seu WhatsApp server está no ar!** 🚀

